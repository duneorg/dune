/**
 * SearchManager — multi-engine registry with runtime switching.
 *
 * Wraps multiple SearchEngine implementations under a single interface.
 * The active engine handles all queries; switching is instantaneous (no
 * restart needed). Parallel mode fans out to all registered engines and
 * merges results by score.
 *
 * The built-in in-memory engine is always registered as "built-in".
 * Plugins register additional engines via the `register` callback in the
 * `onSearchEngineCreate` hook payload and optionally call `setActiveEngine`
 * to make theirs the default.
 *
 * ## When an engine fails
 *
 * Search is secondary to serving content, so a backend that is down (a
 * Meilisearch that is still booting, say) must not take the site down with it:
 *
 *  - Engines build independently. A failure is logged once, loudly, with its
 *    cause, and the engine is marked `failed`; the others carry on.
 *  - Queries go to the active engine while it is usable, and otherwise to the
 *    next usable one (the built-in engine indexes the same pages, so it is
 *    the usual fallback). With nothing usable, `search()` throws
 *    {@link SearchUnavailableError}, which the HTTP API turns into a 503.
 *  - A failed engine is retried in the background with exponential backoff and
 *    takes over again once it recovers.
 *  - {@link SearchManager.status} reports all of this, for `/health` and
 *    `dune doctor`.
 *
 * Two things still stop the process: an engine that throws
 * {@link SearchConfigError} (it will not fix itself, e.g. a rejected API key)
 * and `system.search.fail_on_startup: true`.
 */

import type {
  FacetCounts,
  InjectedSearchRecord,
  SearchEngine,
  SearchOptions,
  SearchResult,
} from "./engine.ts";
import type { PageIndex } from "../content/types.ts";
import { formatErrorChain } from "../cli/error-format.ts";
import { logger } from "../core/logger.ts";

/**
 * Throw this from an engine's `build()` / `rebuild()` for a failure that
 * retrying cannot fix: a rejected API key, an invalid index configuration.
 * At startup it aborts boot with the message; at runtime the engine is marked
 * failed without being retried.
 */
export class SearchConfigError extends Error {
  override name = "SearchConfigError";
}

/**
 * True for a {@link SearchConfigError}, including one thrown by another copy of
 * `@dune/core` (a plugin resolved against a different version has its own
 * class, so `instanceof` alone would miss it).
 */
export function isSearchConfigError(err: unknown): boolean {
  return err instanceof SearchConfigError ||
    (err instanceof Error && err.name === "SearchConfigError");
}

/** No search engine can serve the request right now. The HTTP API answers 503. */
export class SearchUnavailableError extends Error {
  override name = "SearchUnavailableError";
}

/** Health of one registered engine. */
export interface SearchEngineStatus {
  name: string;
  /** `pending`: not built yet (or `buildSearch` was off); `ready`; `failed`. */
  state: "pending" | "ready" | "failed";
  /** The configured (preferred) engine. */
  active: boolean;
  /** Why it is failed, as one line (cause chain joined). */
  error?: string;
  /** Failed build/rebuild attempts since it was last ready. */
  attempts: number;
  /** When the next background retry runs (epoch ms), if one is scheduled. */
  nextRetryAt?: number;
}

/** Tuning for {@link createSearchManager}. */
export interface SearchManagerOptions {
  /** Abort `build()` when any engine fails (`system.search.fail_on_startup`). */
  failOnStartup?: boolean;
  /** Background retry backoff. Default: 5 s doubling to 5 min. */
  retry?: { baseMs?: number; maxMs?: number };
}

/** Extended search interface with multi-engine management. */
export interface SearchManager extends SearchEngine {
  /** Register a named engine. Replaces any existing registration for that name. */
  register(name: string, engine: SearchEngine): void;
  /** Switch the active engine at runtime. Throws if name is not registered. */
  setActiveEngine(name: string): void;
  /** Name of the currently active engine. */
  activeEngineName(): string;
  /** Names of all registered engines. */
  registeredEngineNames(): string[];
  /**
   * Enable parallel mode: query() fans out to all registered engines and
   * merges results by score with deduplication. Useful for warming/testing
   * a new backend before switching. Off by default.
   */
  setParallelMode(enabled: boolean): void;
  /** Whether parallel mode is currently on. */
  isParallelMode(): boolean;
  /** Per-engine health, in registration order. */
  status(): SearchEngineStatus[];
  /** True when at least one registered engine is failed. */
  isDegraded(): boolean;
  /** The engine that would answer a query right now, or null if none can. */
  servingEngineName(): string | null;
  /** Stop background retries. */
  close(): void;
}

interface Entry {
  engine: SearchEngine;
  state: "pending" | "ready" | "failed";
  error?: string;
  attempts: number;
  retryable: boolean;
  nextRetryAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const QUERY_WARN_INTERVAL_MS = 60_000;

/** Create a SearchManager with the built-in engine pre-registered as `"built-in"`. */
export function createSearchManager(
  builtInEngine: SearchEngine,
  options: SearchManagerOptions = {},
): SearchManager {
  const baseMs = options.retry?.baseMs ?? 5_000;
  const maxMs = options.retry?.maxMs ?? 5 * 60_000;
  const entries = new Map<string, Entry>();
  const queryWarnedAt = new Map<string, number>();
  let lastPages: PageIndex[] | null = null;
  let lastRecords: InjectedSearchRecord[] | undefined;
  let closed = false;

  const fresh = (engine: SearchEngine): Entry => ({
    engine,
    state: "pending",
    attempts: 0,
    retryable: true,
  });
  entries.set("built-in", fresh(builtInEngine));

  let active = "built-in";
  let parallel = false;

  /** Usable engines, best first: the active one, then built-in, then the rest. */
  function candidates(): Array<[string, Entry]> {
    const usable = [...entries].filter(([, e]) => e.state !== "failed");
    const rank = ([name]: [string, Entry]) => name === active ? 0 : name === "built-in" ? 1 : 2;
    return usable.sort((a, b) => rank(a) - rank(b));
  }

  function scheduleRetry(name: string, entry: Entry): void {
    if (closed || !entry.retryable) return;
    clearTimeout(entry.timer);
    const delay = Math.min(maxMs, baseMs * 2 ** Math.max(0, entry.attempts - 1));
    entry.nextRetryAt = Date.now() + delay;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      entry.nextRetryAt = undefined;
      if (closed || entries.get(name) !== entry) return;
      // Retry what failed: re-index current pages if we have seen them, else the first build.
      const pages = lastPages;
      const records = lastRecords;
      void attempt(
        name,
        entry,
        pages ? "rebuild" : "build",
        () => pages ? entry.engine.rebuild(pages, records) : entry.engine.build(),
      );
    }, delay);
    Deno.unrefTimer(entry.timer as unknown as number);
  }

  /** Run one engine operation, record the outcome. Never throws; returns the error, if any. */
  async function attempt(
    name: string,
    entry: Entry,
    op: "build" | "rebuild",
    fn: () => Promise<void>,
  ): Promise<Error | null> {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.nextRetryAt = undefined;
    const wasFailed = entry.state === "failed";
    try {
      await fn();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const err = new Error(`Search engine "${name}" failed to ${op}: ${detail}`, { cause });
      entry.state = "failed";
      entry.attempts++;
      entry.retryable = !isSearchConfigError(cause);
      entry.error = formatErrorChain(err).join(" ").replace(/\s+/g, " ");
      scheduleRetry(name, entry);
      // Loud the first time; later retries stay at debug so a long outage is not a log flood.
      logger[entry.attempts === 1 ? "warn" : "debug"]("search.engine.failed", {
        engine: name,
        op,
        reason: entry.error,
        fallback: candidates()[0]?.[0] ?? null,
        retry_in_s: entry.nextRetryAt ? Math.round((entry.nextRetryAt - Date.now()) / 1000) : null,
      });
      return err;
    }
    entry.state = "ready";
    entry.error = undefined;
    entry.attempts = 0;
    entry.retryable = true;
    if (wasFailed) logger.info("search.engine.recovered", { engine: name });
    return null;
  }

  async function runAll(op: "build" | "rebuild", fn: (e: SearchEngine) => Promise<void>) {
    const errors = await Promise.all(
      [...entries].map(([name, entry]) => attempt(name, entry, op, () => fn(entry.engine))),
    );
    return errors;
  }

  function close(): void {
    closed = true;
    for (const e of entries.values()) clearTimeout(e.timer);
  }

  function noteQueryFailure(name: string, err: unknown, op: string): void {
    const now = Date.now();
    if (now - (queryWarnedAt.get(name) ?? 0) < QUERY_WARN_INTERVAL_MS) return;
    queryWarnedAt.set(name, now);
    logger.warn("search.engine.query_failed", {
      engine: name,
      op,
      reason: formatErrorChain(err).join(" ").replace(/\s+/g, " "),
    });
  }

  /** Try usable engines in order until one answers. */
  async function viaCandidates<T>(op: string, call: (e: SearchEngine) => Promise<T>): Promise<T> {
    const list = candidates();
    if (list.length === 0) {
      throw new SearchUnavailableError("No search engine is available");
    }
    let last: unknown;
    for (const [name, entry] of list) {
      try {
        return await call(entry.engine);
      } catch (err) {
        last = err;
        noteQueryFailure(name, err, op);
      }
    }
    // A lone engine failing is a plain error, as it always was; several
    // failing in turn means search as a whole is out.
    if (list.length === 1) throw last;
    throw new SearchUnavailableError("No search engine could answer", { cause: last });
  }

  return {
    register(name: string, engine: SearchEngine): void {
      const old = entries.get(name);
      if (old) clearTimeout(old.timer);
      entries.set(name, fresh(engine));
    },

    setActiveEngine(name: string): void {
      if (!entries.has(name)) {
        throw new Error(
          `Search engine "${name}" is not registered. Registered: ${
            [...entries.keys()].join(", ")
          }`,
        );
      }
      active = name;
    },

    activeEngineName(): string {
      return active;
    },

    registeredEngineNames(): string[] {
      return [...entries.keys()];
    },

    setParallelMode(enabled: boolean): void {
      parallel = enabled;
    },

    isParallelMode(): boolean {
      return parallel;
    },

    status(): SearchEngineStatus[] {
      return [...entries].map(([name, e]) => ({
        name,
        state: e.state,
        active: name === active,
        ...(e.error ? { error: e.error } : {}),
        attempts: e.attempts,
        ...(e.nextRetryAt ? { nextRetryAt: e.nextRetryAt } : {}),
      }));
    },

    isDegraded(): boolean {
      return [...entries.values()].some((e) => e.state === "failed");
    },

    servingEngineName(): string | null {
      return candidates()[0]?.[0] ?? null;
    },

    close,

    async build(): Promise<void> {
      const errors = (await runAll("build", (e) => e.build())).filter((e): e is Error =>
        e !== null
      );
      const configError = errors.find((e) => isSearchConfigError(e.cause));
      const abort = configError ?? (options.failOnStartup ? errors[0] : undefined);
      if (abort) {
        // Startup is about to fail; nothing should keep retrying behind it.
        close();
        throw abort;
      }
    },

    async rebuild(pages: PageIndex[], injectedRecords?: InjectedSearchRecord[]): Promise<void> {
      lastPages = pages;
      lastRecords = injectedRecords;
      await runAll("rebuild", (e) => e.rebuild(pages, injectedRecords));
    },

    async search(
      query: string,
      limit = 10,
      options?: SearchOptions,
    ): Promise<SearchResult[]> {
      if (!parallel) {
        return viaCandidates("search", (e) => e.search(query, limit, options));
      }
      // Parallel: fan out, merge by score, deduplicate by route.
      const usable = candidates();
      if (usable.length === 0) throw new SearchUnavailableError("No search engine is available");
      const allResults = await Promise.all(
        usable.map(([, { engine }]) =>
          engine.search(query, limit, options).catch(() => [] as SearchResult[])
        ),
      );
      const seen = new Set<string>();
      const merged: SearchResult[] = [];
      for (const result of allResults.flat().sort((a, b) => b.score - a.score)) {
        if (!seen.has(result.page.route)) {
          seen.add(result.page.route);
          merged.push(result);
        }
      }
      return merged.slice(0, limit);
    },

    facetCounts(query: string, field: string): Promise<FacetCounts> {
      return viaCandidates(
        "facetCounts",
        (e) => e.facetCounts ? e.facetCounts(query, field) : Promise.resolve({}),
      );
    },

    async suggest(prefix: string, limit = 10): Promise<string[]> {
      if (!parallel) {
        return viaCandidates("suggest", (e) => e.suggest(prefix, limit));
      }
      const usable = candidates();
      if (usable.length === 0) throw new SearchUnavailableError("No search engine is available");
      const allSuggestions = await Promise.all(
        usable.map(([, { engine }]) => engine.suggest(prefix, limit).catch(() => [] as string[])),
      );
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const s of allSuggestions.flat()) {
        if (!seen.has(s)) {
          seen.add(s);
          merged.push(s);
        }
      }
      return merged.slice(0, limit);
    },
  };
}
