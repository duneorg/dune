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
 * Write and delete operations update both the on-disk file and the in-memory
 * index atomically from the perspective of a single-process Deno server.
 * Multi-process deployments should use AuthzDbAdapter backed by a shared DB.
 */

import type { StorageAdapter as DuneStorage } from "../storage/types.ts";
import { signTuple, verifyTuple } from "./authz-hmac.ts";
import type { SignedTuple } from "./authz-hmac.ts";

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
                const tuple = JSON.parse(new TextDecoder().decode(raw)) as SignedTuple;
                if (!tuple.id) return;

                // HMAC verification — only when a key is configured
                if (this.hmacKey) {
                  const result = await verifyTuple(tuple, this.hmacKey);
                  if (result === "invalid") {
                    console.warn(
                      `[dune/authz] Tuple ${tuple.id} (${e.name}) has an invalid HMAC — ` +
                        "file may have been tampered with. Tuple NOT loaded.",
                    );
                    return;
                  }
                  if (result === "missing" && this.strictHmac) {
                    console.warn(
                      `[dune/authz] Tuple ${tuple.id} (${e.name}) is unsigned but strict HMAC ` +
                        "mode is enabled. Tuple NOT loaded. Run `dune authz:sign` to sign it.",
                    );
                    return;
                  }
                  // result === "missing" (non-strict): unsigned file, accepted during migration
                }

                // Strip the hmac field before storing in the in-memory index
                const { hmac: _hmac, ...stored } = tuple;
                this.tuples.set(stored.id, stored as PolizyStoredTuple);
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
            count++;
          } else {
            console.warn(`[dune/authz] Failed to delete tuple ${id} from disk:`, err);
          }
        }
      }
    }
    return count;
  }

  async findTuples(filter: Partial<PolizyInputTuple>): Promise<PolizyStoredTuple[]> {
    await this.ensureLoaded();
    return [...this.tuples.values()].filter((t) => {
      if (filter.subject) {
        if (t.subject.type !== filter.subject.type || t.subject.id !== filter.subject.id) {
          return false;
        }
      }
      if (filter.relation !== undefined && t.relation !== filter.relation) return false;
      if (filter.object) {
        if (t.object.type !== filter.object.type || t.object.id !== filter.object.id) {
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
    const results: { type: string; id: string }[] = [];
    for (const t of this.tuples.values()) {
      if (
        t.object.type === object.type &&
        t.object.id === object.id &&
        t.relation === relation
      ) {
        if (!options?.subjectType || t.subject.type === options.subjectType) {
          results.push({ type: t.subject.type, id: t.subject.id });
        }
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
    const results: { type: string; id: string }[] = [];
    for (const t of this.tuples.values()) {
      if (
        t.subject.type === subject.type &&
        t.subject.id === subject.id &&
        t.relation === relation
      ) {
        if (!options?.objectType || t.object.type === options.objectType) {
          results.push({ type: t.object.type, id: t.object.id });
        }
      }
    }
    return results;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private matchesFilter(tuple: PolizyStoredTuple, filter: PolizyDeleteFilter): boolean {
    if (filter.who) {
      if (tuple.subject.type !== filter.who.type || tuple.subject.id !== filter.who.id) {
        return false;
      }
    }
    if (filter.was !== undefined && tuple.relation !== filter.was) return false;
    if (filter.onWhat) {
      if (tuple.object.type !== filter.onWhat.type || tuple.object.id !== filter.onWhat.id) {
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
    for (const t of this.tuples.values()) {
      if (
        t.subject.type === subject.type &&
        t.subject.id === subject.id &&
        t.relation === relation &&
        t.object.type === object.type &&
        t.object.id === object.id
      ) {
        return true;
      }
    }
    return false;
  }
}
