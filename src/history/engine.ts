/**
 * History engine — records content revisions and provides history, restore, and diff.
 *
 * Revisions are stored as JSON files per page in the data directory:
 *   {dataDir}/history/{encodedSourcePath}/{revisionNumber}.json
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { ContentRevision, ContentDiff } from "../workflow/types.ts";
import { computeDiff } from "./diff.ts";

export interface HistoryEngineConfig {
  storage: StorageAdapter;
  /** Directory for revision data */
  dataDir: string;
  /** Maximum revisions to keep per page (0 = unlimited) */
  maxRevisions?: number;
}

export interface HistoryEngine {
  /** Record a new revision for a page */
  record(input: RecordInput): Promise<ContentRevision>;
  /** Get revision history for a page (newest first) */
  getHistory(sourcePath: string, limit?: number): Promise<ContentRevision[]>;
  /** Get a specific revision */
  getRevision(sourcePath: string, revisionNumber: number): Promise<ContentRevision | null>;
  /** Get the latest revision for a page */
  getLatest(sourcePath: string): Promise<ContentRevision | null>;
  /** Compute diff between two revisions */
  diff(sourcePath: string, fromRev: number, toRev: number): Promise<ContentDiff | null>;
  /** Compute diff between a revision and current content */
  diffWithCurrent(sourcePath: string, revisionNumber: number, currentContent: string): Promise<ContentDiff | null>;
  /** Get total revision count for a page */
  getRevisionCount(sourcePath: string): Promise<number>;
}

export interface RecordInput {
  sourcePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  author?: string;
  message?: string;
}

/**
 * Create a history engine.
 */
export function createHistoryEngine(config: HistoryEngineConfig): HistoryEngine {
  const { storage, dataDir } = config;
  const maxRevisions = config.maxRevisions ?? 50;

  // Per-path write lock: chains concurrent record() calls for the same page so
  // that getNextNumber() → write() is always atomic per source path. Without
  // this, two simultaneous saves could read the same max revision number and
  // both write to the same path, with the second silently overwriting the first.
  const writeLocks = new Map<string, Promise<unknown>>();

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = writeLocks.get(key) ?? Promise.resolve();
    // Chain fn after prev; run fn even if prev rejected (don't block on errors)
    const next = prev.then(fn, fn);
    // Keep the chain alive but don't propagate the lock-holder's error
    writeLocks.set(key, next.catch(() => {}));
    return next as Promise<T>;
  }

  function pageDir(sourcePath: string): string {
    // Encode sourcePath for safe directory naming
    const encoded = sourcePath.replace(/\//g, "__");
    return `${dataDir}/history/${encoded}`;
  }

  function revisionPath(sourcePath: string, number: number): string {
    return `${pageDir(sourcePath)}/${String(number).padStart(6, "0")}.json`;
  }

  return {
    record(input: RecordInput): Promise<ContentRevision> {
      return withLock(input.sourcePath, async () => {
        const dir = pageDir(input.sourcePath);
        const nextNumber = await getNextNumber(dir);

        const revision: ContentRevision = {
          id: crypto.randomUUID().slice(0, 12),
          sourcePath: input.sourcePath,
          number: nextNumber,
          content: input.content,
          frontmatter: input.frontmatter,
          author: input.author,
          createdAt: Date.now(),
          message: input.message,
        };

        const path = revisionPath(input.sourcePath, nextNumber);
        const data = new TextEncoder().encode(JSON.stringify(revision, null, 2));
        await storage.write(path, data);

        // Prune old revisions if over limit
        if (maxRevisions > 0) {
          await pruneRevisions(dir, maxRevisions);
        }

        return revision;
      });
    },

    async getHistory(sourcePath: string, limit = 20): Promise<ContentRevision[]> {
      const dir = pageDir(sourcePath);
      const revisions = await loadRevisions(dir);

      // Sort newest first
      revisions.sort((a, b) => b.number - a.number);

      return limit > 0 ? revisions.slice(0, limit) : revisions;
    },

    async getRevision(sourcePath: string, revisionNumber: number): Promise<ContentRevision | null> {
      const path = revisionPath(sourcePath, revisionNumber);
      try {
        const data = await storage.read(path);
        return JSON.parse(new TextDecoder().decode(data));
      } catch {
        return null;
      }
    },

    async getLatest(sourcePath: string): Promise<ContentRevision | null> {
      const dir = pageDir(sourcePath);
      const revisions = await loadRevisions(dir);
      if (revisions.length === 0) return null;

      revisions.sort((a, b) => b.number - a.number);
      return revisions[0];
    },

    async diff(sourcePath: string, fromRev: number, toRev: number): Promise<ContentDiff | null> {
      const from = await this.getRevision(sourcePath, fromRev);
      const to = await this.getRevision(sourcePath, toRev);

      if (!from || !to) return null;

      return computeDiff(from.content, to.content);
    },

    async diffWithCurrent(
      sourcePath: string,
      revisionNumber: number,
      currentContent: string,
    ): Promise<ContentDiff | null> {
      const revision = await this.getRevision(sourcePath, revisionNumber);
      if (!revision) return null;

      return computeDiff(revision.content, currentContent);
    },

    async getRevisionCount(sourcePath: string): Promise<number> {
      const dir = pageDir(sourcePath);
      const revisions = await loadRevisions(dir);
      return revisions.length;
    },
  };

  async function getNextNumber(dir: string): Promise<number> {
    try {
      const entries = await storage.list(dir);
      let max = 0;
      for (const entry of entries) {
        if (entry.name.endsWith(".json")) {
          const num = parseInt(entry.name.replace(".json", ""), 10);
          if (!isNaN(num) && num > max) max = num;
        }
      }
      return max + 1;
    } catch {
      return 1;
    }
  }

  async function loadRevisions(dir: string): Promise<ContentRevision[]> {
    try {
      const entries = await storage.list(dir);
      const revisions: ContentRevision[] = [];

      for (const entry of entries) {
        if (entry.name.endsWith(".json")) {
          try {
            const data = await storage.read(`${dir}/${entry.name}`);
            const revision = JSON.parse(new TextDecoder().decode(data));
            revisions.push(revision);
          } catch {
            // Skip invalid files
          }
        }
      }

      return revisions;
    } catch {
      return [];
    }
  }

  async function pruneRevisions(dir: string, limit: number): Promise<void> {
    try {
      const entries = await storage.list(dir);
      const files = entries
        .filter((e) => e.name.endsWith(".json"))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (files.length > limit) {
        const toRemove = files.slice(0, files.length - limit);
        for (const file of toRemove) {
          try {
            await storage.delete(`${dir}/${file.name}`);
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch {
      // Ignore
    }
  }
}
