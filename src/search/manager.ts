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
 */

import type { SearchEngine, SearchResult } from "./engine.ts";
import type { PageIndex } from "../content/types.ts";

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
}

export function createSearchManager(
  builtInEngine: SearchEngine,
): SearchManager {
  const engines = new Map<string, SearchEngine>();
  engines.set("built-in", builtInEngine);

  let active = "built-in";
  let parallel = false;

  return {
    register(name: string, engine: SearchEngine): void {
      engines.set(name, engine);
    },

    setActiveEngine(name: string): void {
      if (!engines.has(name)) {
        throw new Error(`Search engine "${name}" is not registered. Registered: ${[...engines.keys()].join(", ")}`);
      }
      active = name;
    },

    activeEngineName(): string {
      return active;
    },

    registeredEngineNames(): string[] {
      return [...engines.keys()];
    },

    setParallelMode(enabled: boolean): void {
      parallel = enabled;
    },

    isParallelMode(): boolean {
      return parallel;
    },

    async build(): Promise<void> {
      await Promise.all([...engines.values()].map((e) => e.build()));
    },

    async rebuild(pages: PageIndex[]): Promise<void> {
      await Promise.all([...engines.values()].map((e) => e.rebuild(pages)));
    },

    async search(query: string, limit = 10): Promise<SearchResult[]> {
      if (!parallel) {
        return engines.get(active)!.search(query, limit);
      }
      // Parallel: fan out, merge by score, deduplicate by route.
      const allResults = await Promise.all(
        [...engines.values()].map((e) => e.search(query, limit).catch(() => [] as SearchResult[])),
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

    async suggest(prefix: string, limit = 10): Promise<string[]> {
      if (!parallel) {
        return engines.get(active)!.suggest(prefix, limit);
      }
      const allSuggestions = await Promise.all(
        [...engines.values()].map((e) => e.suggest(prefix, limit).catch(() => [] as string[])),
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
