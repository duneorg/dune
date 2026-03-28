/**
 * AuditLogger — appends entries to a JSONL file and supports filtered queries.
 */

import { dirname } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";
import type {
  AuditEntry,
  AuditLogOptions,
  AuditQuery,
  AuditQueryResult,
} from "./types.ts";

export class AuditLogger {
  private logFile: string;
  private maxQueryEntries: number;

  constructor(opts: AuditLogOptions) {
    this.logFile = opts.logFile;
    this.maxQueryEntries = opts.maxQueryEntries ?? 1000;
  }

  /** Initialize — ensure parent directory exists */
  async init(): Promise<void> {
    await ensureDir(dirname(this.logFile));
  }

  /** Write an audit entry to the log */
  async log(entry: Omit<AuditEntry, "id" | "ts">): Promise<void> {
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(full) + "\n";
    await Deno.writeTextFile(this.logFile, line, { append: true });
  }

  /** Query entries — reads the full file, filters, sorts newest-first, paginates */
  async query(q: AuditQuery = {}): Promise<AuditQueryResult> {
    let entries: AuditEntry[] = [];
    try {
      const text = await Deno.readTextFile(this.logFile);
      entries = text
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      // File doesn't exist yet
      return { entries: [], total: 0 };
    }

    // Filter
    if (q.event) entries = entries.filter((e) => e.event === q.event);
    if (q.actorId) entries = entries.filter((e) => e.actor?.userId === q.actorId);
    if (q.outcome) entries = entries.filter((e) => e.outcome === q.outcome);
    if (q.from) {
      const from = new Date(q.from).getTime();
      entries = entries.filter((e) => new Date(e.ts).getTime() >= from);
    }
    if (q.to) {
      const to = new Date(q.to).getTime();
      entries = entries.filter((e) => new Date(e.ts).getTime() <= to);
    }

    // Newest first
    entries = entries.reverse().slice(0, this.maxQueryEntries);
    const total = entries.length;

    // Paginate
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;
    entries = entries.slice(offset, offset + limit);

    return { entries, total };
  }
}
