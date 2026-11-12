/**
 * AuthzLocalAdapter — flat-file implementation of polizy's StorageAdapter.
 *
 * Permission tuples are stored as individual JSON files:
 *   {dataDir}/permissions/{uuid}.json
 *
 * An in-memory index is built lazily on first use and re-synchronised with the
 * directory at most once per second, so tuples written or deleted by another
 * process (the `dune users:*` CLI against a running server) take effect without
 * a restart.
 *
 * Beyond the flat `tuples` map (id → tuple), three composite-key indexes —
 * by subject+relation, by object+relation, and by subject+object+relation —
 * back `findObjects()`, `findSubjects()`, and `hasTuple()` respectively, per
 * decisions/dec-auth-storage.md's original design. Each is a plain in-memory
 * `Map<string, Set<string>>` of tuple ids, kept in sync by `indexTuple()`/
 * `unindexTuple()` on every load/write/delete — not Deno KV despite the
 * decision doc's literal `Deno.openKv()`-style key examples; a hand-rolled
 * Map delivers the same O(1) hot-path lookup without an extra dependency,
 * consistent with everything else in this adapter already being plain
 * in-memory structures backed by flat files. `findTuples()` and `delete()`
 * keep their full-scan behavior — their filters are genuinely partial
 * (any of subject/relation/object may be omitted), which doesn't map onto
 * any single fixed composite key the way the other three methods' full
 * subject+relation / object+relation / subject+object+relation lookups do.
 *
 * Write and delete operations update both the on-disk file and the in-memory
 * index atomically from the perspective of a single-process Deno server.
 * Multi-process deployments should use AuthzDbAdapter backed by a shared DB.
 *
 * @module
 */

import type { StorageAdapter as DuneStorage } from "../storage/types.ts";
import { signTuple, verifyTuple } from "./authz-hmac.ts";
import type { SignedTuple } from "./authz-hmac.ts";
import { logger } from "../core/logger.ts";

/**
 * Strict HMAC is the default when a key is configured. Escape hatches:
 *   DUNE_AUTHZ_HMAC_ALLOW_UNSIGNED=1  — accept tuples with no hmac field
 *   DUNE_AUTHZ_HMAC_STRICT=0          — legacy equivalent
 */
export function authzStrictHmacFromEnv(): boolean {
  try {
    const allowUnsigned = Deno.env.get("DUNE_AUTHZ_HMAC_ALLOW_UNSIGNED");
    if (allowUnsigned === "1" || allowUnsigned?.toLowerCase() === "true") {
      logger.warn("authz.hmac.allow_unsigned", {
        reason:
          "DUNE_AUTHZ_HMAC_ALLOW_UNSIGNED is set — unsigned permission tuples are " +
          "accepted. This weakens tamper detection and should only be used during " +
          "a signed-tuple migration, never in steady-state production.",
      });
      return false;
    }
    const legacy = Deno.env.get("DUNE_AUTHZ_HMAC_STRICT");
    if (legacy === "0" || legacy?.toLowerCase() === "false") {
      logger.warn("authz.hmac.allow_unsigned", {
        reason:
          "DUNE_AUTHZ_HMAC_STRICT=0 — unsigned permission tuples are accepted. " +
          "This weakens tamper detection; re-enable strict mode after migration.",
      });
      return false;
    }
    return true;
  } catch {
    // Env access not granted — stay strict.
    return true;
  }
}

// ── Polizy StorageAdapter type aliases (avoid importing internal types) ────────
// These mirror the shapes from polizy's index.d.ts without importing the full
// type tree. All generic parameters resolve to string in Dune's usage.

interface PolizyStoredTuple {
  id: string;
  subject: { type: string; id: string };
  relation: string;
  object: { type: string; id: string };
  condition?: { validSince?: string; validUntil?: string };
}

type PolizyInputTuple = Omit<PolizyStoredTuple, "id">;

interface PolizyDeleteFilter {
  who?: { type: string; id: string };
  was?: string;
  onWhat?: { type: string; id: string };
}

/** Implements polizy's StorageAdapter<string, string> for flat-file storage. */
export class AuthzLocalAdapter {
  private readonly storage: DuneStorage;
  private readonly permissionsDir: string;
  /**
   * Optional HMAC key for tuple file integrity verification.
   * When set: new tuples are signed on write; tuples with a valid hmac are
   * loaded; tuples with an invalid hmac are rejected; unsigned tuples are
   * rejected unless strict mode is off. When null: signing and verification
   * are skipped (no key configured).
   */
  private readonly hmacKey: CryptoKey | null;
  /**
   * Strict HMAC mode. When true and a key is configured, unsigned tuples (no
   * `hmac` field) are rejected. Defaults to on; set
   * DUNE_AUTHZ_HMAC_ALLOW_UNSIGNED=1 (or DUNE_AUTHZ_HMAC_STRICT=0) to
   * accept unsigned files during `dune authz:sign` migration.
   */
  private readonly strictHmac: boolean;
  /** In-memory tuple index — rebuilt from disk on first access */
  private readonly tuples: Map<string, PolizyStoredTuple> = new Map();
  /**
   * Composite-key hot-path indexes, per decisions/dec-auth-storage.md:
   *   subject  → ["subject", sType, sId, relation]        → tuple ids
   *   object   → ["object",  oType, oId, relation]         → tuple ids
   *   s-o      → ["s-o", sType, sId, oType, oId, relation]  → tuple ids
   * Each value is a Set (not a single id) because write() never checked for
   * an existing identical tuple before creating a new one — callers that
   * skip hasTuple() first could in principle produce more than one tuple
   * file for the same subject+object+relation, and the index has to stay
   * correct if that ever happens rather than silently dropping one.
   * Kept in sync by indexTuple()/unindexTuple() on every write()/delete()/
   * initial load — never rebuilt by re-scanning `tuples`.
   */
  private readonly bySubjectRelation: Map<string, Set<string>> = new Map();
  private readonly byObjectRelation: Map<string, Set<string>> = new Map();
  private readonly bySubjectObjectRelation: Map<string, Set<string>> =
    new Map();
  private loaded = false;
  /**
   * In-flight load promise — shared by all concurrent callers so they all await
   * the same disk scan rather than each returning immediately with an empty index.
   *
   * Without this cache, the following race is possible:
   *   1. Call A: `this.loaded` is false → sets `this.loaded = true` (sync), starts
   *      `this.storage.list()` (async, yields the event loop).
   *   2. Call B: `this.loaded` is now true → returns immediately.
   *   3. Call B proceeds to use `this.tuples`, which is still empty.
   *   4. Call A eventually completes and populates `this.tuples` — too late for B.
   */
  private loadPromise: Promise<void> | null = null;

  constructor(
    config: {
      storage: DuneStorage;
      dataDir: string;
      hmacKey?: CryptoKey | null;
      strictHmac?: boolean;
      /** Min ms between directory rescans (default 1000; 0 = every call). */
      refreshIntervalMs?: number;
    },
  ) {
    this.refreshIntervalMs = config.refreshIntervalMs ?? 1000;
    this.storage = config.storage;
    this.permissionsDir = `${config.dataDir}/permissions`;
    this.hmacKey = config.hmacKey ?? null;
    this.strictHmac = config.strictHmac ?? authzStrictHmacFromEnv();
  }

  // ── Composite-key index maintenance ─────────────────────────────────────────

  // JSON.stringify() of a same-length string array is injective — two
  // different (type, id, relation) triples can never produce the same key,
  // without needing a delimiter character that itself risks colliding with
  // application data. (An earlier version of this used a NUL-byte
  // delimiter, which is collision-safe too but makes git/most tooling treat
  // the whole file as binary — no line diffs, awkward in review. Plain
  // JSON avoids that entirely and stays readable.)
  private static subjectRelationKey(
    subject: { type: string; id: string },
    relation: string,
  ): string {
    return JSON.stringify([subject.type, subject.id, relation]);
  }

  private static objectRelationKey(
    object: { type: string; id: string },
    relation: string,
  ): string {
    return JSON.stringify([object.type, object.id, relation]);
  }

  private static subjectObjectRelationKey(
    subject: { type: string; id: string },
    object: { type: string; id: string },
    relation: string,
  ): string {
    return JSON.stringify([
      subject.type,
      subject.id,
      object.type,
      object.id,
      relation,
    ]);
  }

  private static addToIndex(
    index: Map<string, Set<string>>,
    key: string,
    tupleId: string,
  ): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(tupleId);
  }

  private static removeFromIndex(
    index: Map<string, Set<string>>,
    key: string,
    tupleId: string,
  ): void {
    const set = index.get(key);
    if (!set) return;
    set.delete(tupleId);
    if (set.size === 0) index.delete(key);
  }

  private indexTuple(tuple: PolizyStoredTuple): void {
    AuthzLocalAdapter.addToIndex(
      this.bySubjectRelation,
      AuthzLocalAdapter.subjectRelationKey(tuple.subject, tuple.relation),
      tuple.id,
    );
    AuthzLocalAdapter.addToIndex(
      this.byObjectRelation,
      AuthzLocalAdapter.objectRelationKey(tuple.object, tuple.relation),
      tuple.id,
    );
    AuthzLocalAdapter.addToIndex(
      this.bySubjectObjectRelation,
      AuthzLocalAdapter.subjectObjectRelationKey(
        tuple.subject,
        tuple.object,
        tuple.relation,
      ),
      tuple.id,
    );
  }

  private unindexTuple(tuple: PolizyStoredTuple): void {
    AuthzLocalAdapter.removeFromIndex(
      this.bySubjectRelation,
      AuthzLocalAdapter.subjectRelationKey(tuple.subject, tuple.relation),
      tuple.id,
    );
    AuthzLocalAdapter.removeFromIndex(
      this.byObjectRelation,
      AuthzLocalAdapter.objectRelationKey(tuple.object, tuple.relation),
      tuple.id,
    );
    AuthzLocalAdapter.removeFromIndex(
      this.bySubjectObjectRelation,
      AuthzLocalAdapter.subjectObjectRelationKey(
        tuple.subject,
        tuple.object,
        tuple.relation,
      ),
      tuple.id,
    );
  }

  // ── Index load / refresh ────────────────────────────────────────────────────

  /** Minimum interval between directory rescans (ms). */
  private readonly refreshIntervalMs: number;
  /** Tuple file name → tuple id, for every file currently in the index. */
  private readonly fileToId: Map<string, string> = new Map();
  /**
   * Files that failed verification → the raw content that was rejected. They
   * are retried on every rescan (so `authz:sign` can pick them up) but only
   * logged again if their content changes.
   */
  private readonly rejected: Map<string, string> = new Map();
  private lastRefresh = 0;

  /**
   * Bring the in-memory index in line with data/permissions/.
   *
   * The first call loads everything. Later calls (throttled to once per
   * `refreshIntervalMs`, default 1000) rescan the directory so tuples written or deleted by
   * another process — `dune users:create`, `users:grant-role`, `authz:sign`
   * run against a live server — take effect without a restart. Tuple files are
   * immutable once written, so only added/removed file names are processed;
   * files that failed verification are retried on each rescan so signing them
   * later picks them up.
   */
  private ensureLoaded(): Promise<void> {
    if (this.loadPromise !== null) return this.loadPromise;
    if (
      this.loaded &&
      Date.now() - this.lastRefresh < this.refreshIntervalMs
    ) {
      return Promise.resolve();
    }

    const run = (async () => {
      try {
        await this.scan();
      } catch {
        // Permissions directory doesn't exist yet — that's fine; writes will create it
      } finally {
        this.loaded = true;
        this.lastRefresh = Date.now();
        this.loadPromise = null;
      }
    })();
    this.loadPromise = run;
    return run;
  }

  private async scan(): Promise<void> {
    // Only files known before the listing are removal candidates: a tuple
    // written in-process while list() was pending is not in the listing yet.
    //
    // Known race: an in-process delete() that lands while this scan's list()
    // is pending can see the just-revoked tuple's file in the (stale) listing
    // and re-add it. The next rescan (<= refreshIntervalMs later) removes it
    // again, since the file is gone from disk by then.
    const known = new Set(this.fileToId.keys());
    let entries: Awaited<ReturnType<DuneStorage["list"]>>;
    try {
      entries = await this.storage.list(this.permissionsDir);
    } catch (err) {
      // A vanished directory means every tuple file is gone. Confirmed with
      // exists() so a transient list() error doesn't wipe the index.
      if (await this.storage.exists(this.permissionsDir)) throw err;
      entries = [];
    }
    const files = entries.filter((e) => e.isFile && e.name.endsWith(".json"));
    const present = new Set(files.map((e) => e.name));
    for (const name of this.rejected.keys()) {
      if (!present.has(name)) this.rejected.delete(name);
    }

    // Removed by another process
    for (const [name, id] of [...this.fileToId]) {
      if (present.has(name) || !known.has(name)) continue;
      const tuple = this.tuples.get(id);
      if (tuple) {
        this.tuples.delete(id);
        this.unindexTuple(tuple);
      }
      this.fileToId.delete(name);
    }

    // New (or previously rejected) files
    await Promise.all(
      files
        .filter((e) => !this.fileToId.has(e.name))
        .map((e) => this.loadFile(e)),
    );
  }

  private async loadFile(e: { name: string; path: string }): Promise<void> {
    try {
      const raw = await this.storage.read(e.path);
      const text = new TextDecoder().decode(raw);
      const tuple = JSON.parse(text) as SignedTuple;
      if (!tuple.id) return;

      // HMAC verification — only when a key is configured
      if (this.hmacKey) {
        const result = await verifyTuple(tuple, this.hmacKey);
        if (result === "invalid") {
          if (this.rejected.get(e.name) === text) return;
          this.rejected.set(e.name, text);
          logger.warn("authz.tuple.invalid_hmac", {
            tupleId: tuple.id,
            file: e.name,
            reason:
              "invalid HMAC — file may have been tampered with. Tuple NOT loaded.",
          });
          return;
        }
        if (result === "missing" && this.strictHmac) {
          if (this.rejected.get(e.name) === text) return;
          this.rejected.set(e.name, text);
          logger.warn("authz.tuple.unsigned_strict", {
            tupleId: tuple.id,
            file: e.name,
            reason:
              "unsigned but strict HMAC mode is enabled. Tuple NOT loaded. Run `dune authz:sign` to sign it.",
          });
          return;
        }
        // result === "missing" (non-strict): unsigned file, accepted during migration
      }

      // Strip the hmac field before storing in the in-memory index
      const { hmac: _hmac, ...stored } = tuple;
      const storedTuple = stored as PolizyStoredTuple;
      if (this.tuples.has(storedTuple.id)) return; // written in-process meanwhile
      this.tuples.set(storedTuple.id, storedTuple);
      this.indexTuple(storedTuple);
      this.fileToId.set(e.name, storedTuple.id);
      this.rejected.delete(e.name);
    } catch {
      // Skip corrupt files
    }
  }

  // ── StorageAdapter methods ──────────────────────────────────────────────────

  async write(inputTuples: PolizyInputTuple[]): Promise<PolizyStoredTuple[]> {
    await this.ensureLoaded();
    const results: PolizyStoredTuple[] = [];
    for (const input of inputTuples) {
      const id = crypto.randomUUID();
      const stored: PolizyStoredTuple = { ...input, id };

      // Sign the tuple if a key is configured; write the signed form to disk
      // but keep only the unsigned form in the in-memory index (hmac is
      // a storage-layer concern, not needed for runtime checks).
      const onDisk: SignedTuple = { ...stored };
      if (this.hmacKey) {
        onDisk.hmac = await signTuple(stored, this.hmacKey);
      }

      await this.storage.write(
        `${this.permissionsDir}/${id}.json`,
        new TextEncoder().encode(JSON.stringify(onDisk, null, 2)),
      );
      this.tuples.set(id, stored);
      this.indexTuple(stored);
      this.fileToId.set(`${id}.json`, id);
      results.push(stored);
    }
    return results;
  }

  async delete(filter: PolizyDeleteFilter): Promise<number> {
    await this.ensureLoaded();
    let count = 0;
    for (const [id, tuple] of this.tuples) {
      if (this.matchesFilter(tuple, filter)) {
        try {
          await this.storage.delete(`${this.permissionsDir}/${id}.json`);
          // Only remove from the in-memory index once the disk write succeeds.
          // This ensures that if the disk operation fails (e.g. a transient I/O
          // error), the tuple is not silently dropped from the index: on the next
          // process restart the file will still be present and the tuple will be
          // reloaded — stale permissions are the safe-fail direction here.
          this.tuples.delete(id);
          this.unindexTuple(tuple);
          this.fileToId.delete(`${id}.json`);
          count++;
        } catch (err) {
          // File already gone is fine — remove from in-memory index so the two
          // stores stay consistent. Any other storage error is logged and the
          // in-memory entry is left intact so a restart can reload from disk.
          const isGone = err instanceof Error &&
            (err.message.includes("ENOENT") ||
              err.message.includes("not found") ||
              err.message.includes("No such file"));
          if (isGone) {
            this.tuples.delete(id);
            this.unindexTuple(tuple);
            this.fileToId.delete(`${id}.json`);
            count++;
          } else {
            logger.warn("authz.tuple.delete_failed", {
              tupleId: id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
    return count;
  }

  async findTuples(
    filter: Partial<PolizyInputTuple>,
  ): Promise<PolizyStoredTuple[]> {
    await this.ensureLoaded();
    return [...this.tuples.values()].filter((t) => {
      if (filter.subject) {
        if (
          t.subject.type !== filter.subject.type ||
          t.subject.id !== filter.subject.id
        ) {
          return false;
        }
      }
      if (filter.relation !== undefined && t.relation !== filter.relation) {
        return false;
      }
      if (filter.object) {
        if (
          t.object.type !== filter.object.type ||
          t.object.id !== filter.object.id
        ) {
          return false;
        }
      }
      return true;
    });
  }

  async findSubjects(
    object: { type: string; id: string },
    relation: string,
    options?: { subjectType?: string },
  ): Promise<{ type: string; id: string }[]> {
    await this.ensureLoaded();
    const tupleIds = this.byObjectRelation.get(
      AuthzLocalAdapter.objectRelationKey(object, relation),
    );
    if (!tupleIds) return [];
    const results: { type: string; id: string }[] = [];
    for (const id of tupleIds) {
      const t = this.tuples.get(id);
      if (!t) continue; // index/store desync should be impossible, but don't crash on it
      if (!options?.subjectType || t.subject.type === options.subjectType) {
        results.push({ type: t.subject.type, id: t.subject.id });
      }
    }
    return results;
  }

  async findObjects(
    subject: { type: string; id: string },
    relation: string,
    options?: { objectType?: string },
  ): Promise<{ type: string; id: string }[]> {
    await this.ensureLoaded();
    const tupleIds = this.bySubjectRelation.get(
      AuthzLocalAdapter.subjectRelationKey(subject, relation),
    );
    if (!tupleIds) return [];
    const results: { type: string; id: string }[] = [];
    for (const id of tupleIds) {
      const t = this.tuples.get(id);
      if (!t) continue; // index/store desync should be impossible, but don't crash on it
      if (!options?.objectType || t.object.type === options.objectType) {
        results.push({ type: t.object.type, id: t.object.id });
      }
    }
    return results;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private matchesFilter(
    tuple: PolizyStoredTuple,
    filter: PolizyDeleteFilter,
  ): boolean {
    if (filter.who) {
      if (
        tuple.subject.type !== filter.who.type ||
        tuple.subject.id !== filter.who.id
      ) {
        return false;
      }
    }
    if (filter.was !== undefined && tuple.relation !== filter.was) return false;
    if (filter.onWhat) {
      if (
        tuple.object.type !== filter.onWhat.type ||
        tuple.object.id !== filter.onWhat.id
      ) {
        return false;
      }
    }
    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Return the number of tuples currently in the in-memory index.
   * Useful for bootstrapping decisions (e.g. skip if index is already populated).
   */
  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.tuples.size;
  }

  /**
   * Check whether a specific tuple already exists (subject + relation + object).
   * Used by the bootstrap path to avoid creating duplicate tuples.
   */
  async hasTuple(
    subject: { type: string; id: string },
    relation: string,
    object: { type: string; id: string },
  ): Promise<boolean> {
    await this.ensureLoaded();
    const key = AuthzLocalAdapter.subjectObjectRelationKey(
      subject,
      object,
      relation,
    );
    const tupleIds = this.bySubjectObjectRelation.get(key);
    return (tupleIds?.size ?? 0) > 0;
  }
}
