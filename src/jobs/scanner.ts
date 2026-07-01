/**
 * Job file scanner — loads and validates job definitions.
 *
 * Each file must export:
 *   export const schedule = "cron expression";   // required
 *   export default async function handler(ctx) {} // required
 *
 * Files without both exports are silently skipped.
 *
 * ## Explicit allowlist (recommended)
 *
 * Pass `declaredPaths` (from `config.site.jobs`) to restrict loading to
 * explicitly declared files. Only those paths are imported; all other files
 * in the `jobs/` directory are ignored.
 *
 * Each declared path is validated against the project root using URL-
 * normalisation containment — paths that escape the root (e.g. `../../etc/`)
 * are rejected at load time with an error rather than silently loaded.
 *
 * ## Auto-discovery fallback (legacy, deprecated)
 *
 * When `declaredPaths` is `undefined`, all `*.ts` files under `{root}/jobs/`
 * are imported automatically. This behaviour is deprecated: any file written
 * to `jobs/` is executed within one scheduler tick, so write access to that
 * directory is equivalent to remote code execution.
 *
 * Migrate by adding a `jobs:` key to `site.yaml`:
 *
 *   site:
 *     jobs:
 *       - ./jobs/weekly-digest.ts
 *
 * Set `jobs: []` to disable all background jobs with no warning.
 *
 * ⚠️  SECURITY: auto-discovery is retained only for backward compatibility.
 * New deployments should always use the explicit list.
 */

import { isAbsolute, join, normalize, resolve, SEPARATOR } from "@std/path";
import type { JobDefinition } from "./types.ts";
import { logger } from "../core/logger.ts";

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Resolve a declared job path to an absolute filesystem path, refusing
 * anything that escapes the project root.
 *
 * Returns the absolute path on success, or null with a logged error on failure.
 */
function resolveJobPath(root: string, declared: string): string | null {
  // Strip a leading "./" so the path is relative to root.
  const stripped = declared.replace(/^\.\//, "");

  // Reject absolute paths — declared job paths must be relative to the project root.
  if (isAbsolute(stripped)) {
    logger.error("jobs.path.not_relative", {
      declared,
      reason: "declared job path must be relative — skipped.",
    });
    return null;
  }

  const normalized = normalize(stripped);

  // URL-normalisation containment check (same pattern as upload handler).
  const rootAbs = resolve(root);
  const candidate = resolve(root, normalized);
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + SEPARATOR)) {
    logger.error("jobs.path.escapes_root", {
      declared,
      reason: "declared job path escapes the project root — skipped.",
    });
    return null;
  }

  return candidate;
}

// ── File loader ───────────────────────────────────────────────────────────────

/** Import one job file and return its JobDefinition, or null on failure. */
async function loadJobFile(filePath: string, displayName: string): Promise<JobDefinition | null> {
  try {
    const mod = await import(filePath); // lockfile-safe: site-local (job file from site jobs/ directory)
    const schedule = mod.schedule;
    const handler = mod.default;

    if (typeof schedule !== "string" || !schedule.trim()) {
      // Missing or empty schedule — silently skip (files without exports are ignored per spec).
      return null;
    }

    if (typeof handler !== "function") {
      logger.warn("jobs.load.missing_handler", {
        job: displayName,
        reason: "missing default export handler — skipped",
      });
      return null;
    }

    // Derive the job name from the filename stem (last path segment, no extension).
    const stem = filePath.replace(/\.[^/.]+$/, "").split(SEPARATOR).at(-1) ?? displayName;
    return { name: stem, schedule: schedule.trim(), handler };
  } catch (err) {
    logger.warn("jobs.load.failed", {
      job: displayName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load job definitions from the project.
 *
 * @param root          Absolute path to the project root.
 * @param declaredPaths Explicit job file list from `config.site.jobs`.
 *                      - `string[]` (even empty) → allowlist mode; only listed files are loaded.
 *                      - `undefined` → legacy auto-discovery with a deprecation warning.
 */
export async function scanJobs(
  root: string,
  declaredPaths?: string[],
): Promise<JobDefinition[]> {
  if (declaredPaths !== undefined) {
    return loadDeclared(root, declaredPaths);
  }
  return loadAutoDiscovered(root);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/** Load only the explicitly declared job files. */
async function loadDeclared(root: string, declared: string[]): Promise<JobDefinition[]> {
  if (declared.length === 0) return [];

  const definitions: JobDefinition[] = [];
  for (const path of declared) {
    const absPath = resolveJobPath(root, path);
    if (!absPath) continue; // error already logged
    const def = await loadJobFile(absPath, path);
    if (def) definitions.push(def);
  }
  return definitions;
}

/** Auto-discover all *.ts files under {root}/jobs/ — legacy fallback. */
async function loadAutoDiscovered(root: string): Promise<JobDefinition[]> {
  const jobsDir = join(root, "jobs");

  // Only emit the deprecation warning when the directory actually exists —
  // sites with no jobs/ should not see noise.
  let hasJobsDir = false;
  try {
    const stat = await Deno.stat(jobsDir);
    hasJobsDir = stat.isDirectory;
  } catch { /* not found — fine */ }

  if (!hasJobsDir) return [];

  logger.warn("jobs.autodiscovery.deprecated", {
    reason:
      "Auto-discovery is deprecated and will be removed in a future release. Any file " +
      "written to jobs/ is executed automatically — this is a code-execution risk. Add an " +
      "explicit list to site.yaml (site.jobs: [./jobs/your-job.ts]) to silence this warning, " +
      "or set jobs: [] to disable all background jobs.",
  });

  let entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(jobsDir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) entries.push(entry);
    }
  } catch {
    return [];
  }

  entries = entries.sort((a, b) => a.name.localeCompare(b.name));

  const definitions: JobDefinition[] = [];
  for (const entry of entries) {
    const def = await loadJobFile(join(jobsDir, entry.name), entry.name);
    if (def) definitions.push(def);
  }
  return definitions;
}
