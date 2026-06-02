/**
 * Job file scanner — discovers and validates jobs/*.ts files.
 *
 * Each file must export:
 *   export const schedule = "cron expression";   // required
 *   export default async function handler(ctx) {} // required
 *
 * Files without both exports are silently skipped (logged at debug level).
 */

import { join } from "@std/path";
import type { JobDefinition } from "./types.ts";

/**
 * Scan {root}/jobs/*.ts, import each file, and return valid JobDefinitions.
 * Files that fail to import or are missing required exports are skipped.
 */
export async function scanJobs(root: string): Promise<JobDefinition[]> {
  const jobsDir = join(root, "jobs");
  const definitions: JobDefinition[] = [];

  let entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(jobsDir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        entries.push(entry);
      }
    }
  } catch {
    // jobs/ directory doesn't exist — no jobs configured
    return [];
  }

  entries = entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const name = entry.name.slice(0, -3); // strip .ts
    const filePath = join(jobsDir, entry.name);

    try {
      const mod = await import(filePath);

      const schedule = mod.schedule;
      const handler = mod.default;

      if (typeof schedule !== "string" || !schedule.trim()) {
        // Missing schedule — silently skip (per spec)
        continue;
      }

      if (typeof handler !== "function") {
        console.warn(`[dune/jobs] ${entry.name}: missing default export handler — skipped`);
        continue;
      }

      definitions.push({ name, schedule: schedule.trim(), handler });
    } catch (err) {
      console.warn(`[dune/jobs] Failed to load ${entry.name}:`, err);
    }
  }

  return definitions;
}
