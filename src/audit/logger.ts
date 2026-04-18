/**
 * AuditLogger — appends entries to daily-rotated JSONL files.
 *
 * Shards are written to `{dir}/{basename}/YYYY-MM-DD.jsonl`, where `{dir}` and
 * `{basename}` are derived from `logFile`. Queries enumerate only the shards
 * whose date falls within `from`/`to` (or all shards when the range is open).
 * The legacy single-file layout (just `logFile`) is read as a fallback so an
 * upgrade from pre-sharding installs doesn't lose history.
 */

import { dirname, basename, extname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import type {
  AuditEntry,
  AuditLogOptions,
  AuditQuery,
  AuditQueryResult,
} from "./types.ts";

const SHARD_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export class AuditLogger {
  private readonly logFile: string;        // legacy path (fallback on read)
  private readonly shardDir: string;       // directory holding daily shards
  private readonly maxQueryEntries: number;

  constructor(opts: AuditLogOptions) {
    this.logFile = opts.logFile;
    const ext = extname(this.logFile) || ".log";
    const stem = basename(this.logFile, ext);
    this.shardDir = join(dirname(this.logFile), stem);
    this.maxQueryEntries = opts.maxQueryEntries ?? 1000;
  }

  /** Initialize — ensure shard directory exists */
  async init(): Promise<void> {
    await ensureDir(this.shardDir);
  }

  /** Write an audit entry to today's shard */
  async log(entry: Omit<AuditEntry, "id" | "ts">): Promise<void> {
    const ts = new Date();
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      ts: ts.toISOString(),
      ...entry,
    };
    const line = JSON.stringify(full) + "\n";
    const shardPath = join(this.shardDir, `${ts.toISOString().slice(0, 10)}.jsonl`);
    await Deno.writeTextFile(shardPath, line, { append: true });
  }

  /** Query entries — reads only shards within the requested date range */
  async query(q: AuditQuery = {}): Promise<AuditQueryResult> {
    const shards = await this.listShards(q.from, q.to);

    const fromMs = q.from ? new Date(q.from).getTime() : -Infinity;
    const toMs = q.to ? new Date(q.to).getTime() : Infinity;

    // Accumulate newest-first across shards; stop once we have enough to
    // satisfy maxQueryEntries after all filters (conservative cap: read
    // enough candidate lines before other filters narrow further).
    const collected: AuditEntry[] = [];
    const entryMatches = (e: AuditEntry): boolean => {
      if (q.event && e.event !== q.event) return false;
      if (q.actorId && e.actor?.userId !== q.actorId) return false;
      if (q.outcome && e.outcome !== q.outcome) return false;
      const ems = new Date(e.ts).getTime();
      if (ems < fromMs || ems > toMs) return false;
      return true;
    };

    // Walk newest shard first.
    for (const shard of shards) {
      const text = await readTextIfExists(shard);
      if (!text) continue;
      const lines = text.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        let entry: AuditEntry;
        try {
          entry = JSON.parse(line) as AuditEntry;
        } catch {
          continue; // tolerate a partial write at end-of-file
        }
        if (!entryMatches(entry)) continue;
        collected.push(entry);
        if (collected.length >= this.maxQueryEntries) break;
      }
      if (collected.length >= this.maxQueryEntries) break;
    }

    const total = collected.length;
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;
    const entries = collected.slice(offset, offset + limit);
    return { entries, total };
  }

  /**
   * Enumerate shard paths that fall within [from, to], newest first.
   * Always includes the legacy single-file path at the end of the list when
   * it exists, so migrations don't drop old entries.
   */
  private async listShards(from?: string, to?: string): Promise<string[]> {
    const fromDate = from ? from.slice(0, 10) : null;
    const toDate = to ? to.slice(0, 10) : null;

    const dates: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.shardDir)) {
        if (!entry.isFile) continue;
        const m = entry.name.match(SHARD_RE);
        if (!m) continue;
        const date = m[1];
        if (fromDate && date < fromDate) continue;
        if (toDate && date > toDate) continue;
        dates.push(date);
      }
    } catch {
      // Shard dir missing — fall through to legacy file only.
    }

    dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first
    const shardPaths = dates.map((d) => join(this.shardDir, `${d}.jsonl`));

    // Include legacy single-file log if still present — oldest-seeming, so
    // it's queried last and its entries land at the tail.
    if (await exists(this.logFile)) {
      shardPaths.push(this.logFile);
    }
    return shardPaths;
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
