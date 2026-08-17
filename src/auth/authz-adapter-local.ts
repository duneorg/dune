/**
 * AuthzLocalAdapter — flat-file implementation of polizy's StorageAdapter.
 *
 * Permission tuples are stored as individual JSON files:
 *   {dataDir}/permissions/{uuid}.json
 *
 * An in-memory index is built at construction time by scanning existing files.
 * On restart the index is rebuilt from disk — consistent with Dune's in-memory
 * rebuild pattern (search index, content index, etc.).
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

/** Read the DUNE_AUTHZ_HMAC_STRICT env flag ("1"/"true"). */
function authzStrictHmacFromEnv(): boolean {
  try {
    const v = Deno.env.get("DUNE_AUTHZ_HMAC_STRICT");
    return v === "1" || v?.toLowerCase() === "true";
  } catch {
    // Env access not granted — default to off.
    return false;
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
   * When set: new tuples are signed on write; existing tuples with a valid or
   * missing `hmac` field are loaded; tuples with an invalid `hmac` are rejected.
   * When null: signing and verification are skipped (fail-open).
   */
  private readonly hmacKey: CryptoKey | null;
  /**
   * Strict HMAC mode. When true and a key is configured, unsigned tuples (no
   * `hmac` field) are rejected rather than accepted. Defaults from the
   * DUNE_AUTHZ_HMAC_STRICT env var ("1"/"true"). Off by default so the
   * migration path (sign existing files with `dune authz:sign`) still works.
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
    },
  ) {
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

  // ── Lazy index load ─────────────────────────────────────────────────────────

  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise !== null) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const entries = await this.storage.list(this.permissionsDir);
        await Promise.all(
          entries
            .filter((e) => e.isFile && e.name.endsWith(".json"))
            .map(async (e) => {
              try {
                const raw = await this.storage.read(e.path);
                const tuple = JSON.parse(
                  new TextDecoder().decode(raw),
                ) as SignedTuple;
                if (!tuple.id) return;

                // HMAC verification — only when a key is configured
                if (this.hmacKey) {
                  const result = await verifyTuple(tuple, this.hmacKey);
                  if (result === "invalid") {
                    logger.warn("authz.tuple.invalid_hmac", {
                      tupleId: tuple.id,
                      file: e.name,
                      reason:
                        "invalid HMAC — file may have been tampered with. Tuple NOT loaded.",
                    });
                    return;
                  }
                  if (result === "missing" && this.strictHmac) {
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
                this.tuples.set(storedTuple.id, storedTuple);
                this.indexTuple(storedTuple);
              } catch {
                // Skip corrupt files
              }
            }),
        );
      } catch {
        // Permissions directory doesn't exist yet — that's fine; writes will create it
      } finally {
        this.loaded = true;
      }
    })();

    return this.loadPromise;
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
