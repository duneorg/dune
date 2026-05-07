/**
 * Static guard-coverage test (MED-23).
 *
 * Walks every TypeScript file under src/admin/routes/api/** and asserts that
 * any handler accepting a mutating HTTP method (POST/PUT/PATCH/DELETE) also
 * invokes csrfCheck() — either directly or through withGuards() (which calls
 * csrfCheck for us). This catches the class of regressions that produced
 * HIGH-4 and MED-23 in the May 2026 audit (mutating routes shipped without
 * the cross-origin guard).
 *
 * The check is intentionally textual (not AST-based) — every mutating route
 * has been written to call one of the two guard helpers, and a textual scan
 * is robust enough to flag a missing call in a code review or CI run.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { walk } from "@std/fs";

const ROUTES_ROOT = new URL("../../src/admin/routes/api/", import.meta.url);

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Routes that are exempt from the textual csrfCheck rule.
 * Every entry must include a justification.
 */
const EXEMPTIONS = new Set<string>([
  // Currently empty — every mutating route should call csrfCheck directly
  // or via withGuards. Add a path here only with a written justification.
]);

Deno.test("MED-23: every mutating admin route invokes csrfCheck", async () => {
  const offenders: string[] = [];

  for await (const entry of walk(ROUTES_ROOT, { exts: [".ts", ".tsx"] })) {
    if (!entry.isFile) continue;
    const rel = entry.path.split("/src/admin/routes/api/")[1];
    if (!rel) continue;
    if (rel.startsWith("_")) continue; // private utilities
    if (EXEMPTIONS.has(rel)) continue;

    const text = await Deno.readTextFile(entry.path);

    // Does the file declare a mutating handler?
    const hasMutating = MUTATING_METHODS.some((m) =>
      // matches `POST(` / `POST:` / `POST,` etc — common Fresh handler shapes.
      new RegExp(`\\b(?:async\\s+)?${m}\\s*[\\(:,]`).test(text)
    );
    if (!hasMutating) continue;

    // Does the file invoke csrfCheck or withGuards?
    const hasGuard = /\bcsrfCheck\s*\(/.test(text) ||
      /\bwithGuards\s*\(/.test(text);

    if (!hasGuard) offenders.push(rel);
  }

  assertEquals(
    offenders,
    [],
    `Mutating admin routes missing csrfCheck/withGuards:\n${offenders.join("\n")}`,
  );
});
