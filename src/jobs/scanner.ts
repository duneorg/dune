/**
 * Job file scanner — loads and validates job definitions.
 *
 * Each file must export:
 *   export const schedule = "cron expression";   // required
 *   export default async function handler(ctx) {} // required
 *   export const timeoutMs = 30_000;              // optional — per-job timeout override
 *
 * Files without both required exports are silently skipped. An invalid
 * timeoutMs (not a positive number) is ignored with a warning — the
 * scheduler's default timeout applies instead, not a hard load failure.
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
 * ## No auto-discovery
 *
 * Jobs are loaded only from the explicit list. When `declaredPaths` is
 * `undefined` no job runs, and a warning is logged if a `jobs/` directory with
 * `*.ts` files exists, because any file written to `jobs/` used to be executed
 * within one scheduler tick (write access to that directory was equivalent to
 * remote code execution). Declare the files in `site.yaml`:
 *
 *   site:
 *     jobs:
 *       - ./jobs/weekly-digest.ts
 *
 * Set `jobs: []` to disable all background jobs with no warning.
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
    const timeoutMs = mod.timeoutMs;

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

    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || timeoutMs <= 0)) {
      logger.warn("jobs.load.invalid_timeout", {
        job: displayName,
        reason: "timeoutMs export must be a positive number — ignoring, default timeout applies",
      });
    }

    // Derive the job name from the filename stem (last path segment, no extension).
    const stem = filePath.replace(/\.[^/.]+$/, "").split(SEPARATOR).at(-1) ?? displayName;
    return {
      name: stem,
      schedule: schedule.trim(),
      handler,
      ...(typeof timeoutMs === "number" && timeoutMs > 0 ? { timeoutMs } : {}),
    };
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
 *                      - `undefined` → no jobs; warns if a `jobs/` directory with
 *                        `*.ts` files exists (they are not loaded automatically).
 */
export async function scanJobs(
  root: string,
  declaredPaths?: string[],
): Promise<JobDefinition[]> {
  if (declaredPaths !== undefined) {
    return loadDeclared(root, declaredPaths);
  }
  await warnIfUndeclaredJobsDir(root);
  return [];
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

/** Warn when a jobs/ directory holds files that will not be loaded. */
async function warnIfUndeclaredJobsDir(root: string): Promise<void> {
  const jobsDir = join(root, "jobs");
  try {
    for await (const entry of Deno.readDir(jobsDir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        logger.warn("jobs.undeclared", {
          reason: "jobs/ contains .ts files but site.yaml has no `jobs:` list, so no background " +
            "jobs run. Jobs are no longer discovered automatically; declare them " +
            "(site.jobs: [./jobs/your-job.ts]) or set jobs: [] to silence this warning.",
        });
        return;
      }
    }
  } catch { /* no jobs/ directory — fine */ }
}
