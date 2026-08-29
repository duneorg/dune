/**
 * check-core-pin-drift.ts
 *
 * Guards against the 2026-07-16 incident recurring: a sibling @dune/*
 * package's published `@dune/core` import range silently stops covering
 * this checkout's own core version, and Deno's workspace auto-linking
 * (or, once published, plain JSR resolution) declines to use it — falling
 * back to whatever older published core version the stale range actually
 * matches, with only a passive console warning nobody watches for.
 * ("Workspace member '@dune/core@0.28.4' was not used because it did not
 * match '@dune/core@^0.27'" — seen live at plugin-admin/mod.ts:23 during a
 * caravan-demo run; plugin-admin's real runtime imports — session store,
 * rate-limit store, workflow engine, staging engine, machine translator —
 * silently ran against a version two minors stale.)
 *
 * Checks the LATEST PUBLISHED version of each known sibling package on
 * JSR — not a local checkout — so this works as real CI in dune's own
 * isolated single-repo checkout, with no access to sibling repos. This
 * also means it catches drift proactively: it fails the moment this
 * checkout's own deno.json version outgrows what's already published
 * downstream, before a core release ships and makes that reality visible
 * to consumers.
 *
 * Scope is deliberately narrower than "every @dune/* package on JSR" —
 * the 40+ theme-* marketplace packages are a different distribution
 * mechanism, not workspace members needing this discipline. The list
 * below mirrors the local dev workspace's member list
 * (/Users/xrs/claude/deno.json's "workspace" array), minus members that
 * don't apply: `themes` imports core via a relative path not jsr:, and
 * private/unpublished members (`getdune`, `eda-worksheets`) can't be
 * checked via JSR fetch at all. A member whose deno.json has no
 * "jsr:@dune/core" import (e.g. plugin-pdf, which doesn't depend on core)
 * is skipped automatically rather than hardcoded as an exception, so this
 * list doesn't need updating if that changes.
 *
 * Usage: deno run --allow-net --allow-read scripts/check-core-pin-drift.ts
 * Exit: 0 = every checked pin covers this checkout's core version
 *       1 = at least one pin has drifted stale
 */

// Direct jsr: specifier (not a deno.json import-map entry) — this script's
// dependency, not part of dune-core's runtime closure that scaffolded sites
// need to carry (tests/cli/new_test.ts's tripwire checks that closure
// against every root deno.json import-map entry; adding one here would trip
// it for a dependency real sites never touch).
import { parse, parseRange, satisfies } from "jsr:@std/semver@^1";

const SIBLING_PACKAGES = [
  "plugin-admin",
  "plugin-meilisearch",
  "plugin-orama",
  "plugin-inline-edit",
  "plugin-pdf",
  "testing",
];

interface DenoJsonShape {
  imports?: Record<string, string>;
}

async function readCoreVersion(): Promise<string> {
  const raw = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );
  const config = JSON.parse(raw) as { version?: string };
  if (!config.version) {
    throw new Error('deno.json has no top-level "version" field');
  }
  return config.version;
}

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  const res = await fetch(`https://api.jsr.io/scopes/dune/packages/${pkg}`);
  if (!res.ok) return null;
  const meta = await res.json() as { latestVersion?: string };
  return meta.latestVersion ?? null;
}

async function fetchDenoJson(
  pkg: string,
  version: string,
): Promise<DenoJsonShape | null> {
  const res = await fetch(`https://jsr.io/@dune/${pkg}/${version}/deno.json`);
  if (!res.ok) return null;
  return await res.json() as DenoJsonShape;
}

/** Extract the `jsr:@dune/core@<range>` range string from an import-map value, if present. */
export function extractCoreRange(denoJson: DenoJsonShape): string | null {
  for (const value of Object.values(denoJson.imports ?? {})) {
    // Stop at the first "/" so a subpath entry (jsr:@dune/core@^0.31/search)
    // yields just the range ("^0.31"), not a bogus "^0.31/search" that would
    // throw when parsed as semver.
    const match = value.match(/^jsr:@dune\/core@([^/]+)/);
    if (match) return match[1];
  }
  return null;
}

async function main() {
  const coreVersion = await readCoreVersion();
  const core = parse(coreVersion);
  console.log(
    `Checking sibling @dune/core pins against this checkout's version ${coreVersion}\n`,
  );

  let violations = 0;
  let skipped = 0;

  for (const pkg of SIBLING_PACKAGES) {
    const latest = await fetchLatestVersion(pkg).catch(() => null);
    if (!latest) {
      console.warn(
        `  ⚠️  @dune/${pkg}: could not fetch latest published version from JSR — skipping`,
      );
      skipped++;
      continue;
    }

    const denoJson = await fetchDenoJson(pkg, latest).catch(() => null);
    if (!denoJson) {
      console.warn(
        `  ⚠️  @dune/${pkg}@${latest}: could not fetch deno.json from JSR — skipping`,
      );
      skipped++;
      continue;
    }

    const rangeStr = extractCoreRange(denoJson);
    if (!rangeStr) {
      // No jsr:@dune/core import at all — package doesn't depend on core (e.g. plugin-pdf). Not a drift case.
      console.log(
        `  ·  @dune/${pkg}@${latest}: no @dune/core import — not applicable`,
      );
      continue;
    }

    const range = parseRange(rangeStr);
    if (satisfies(core, range)) {
      console.log(
        `  ✅ @dune/${pkg}@${latest}: pin "${rangeStr}" covers ${coreVersion}`,
      );
    } else {
      console.error(
        `  ❌ @dune/${pkg}@${latest}: pin "${rangeStr}" does NOT cover ${coreVersion} — ` +
          `this package's real @dune/core imports will silently resolve to a stale core version.`,
      );
      // GitHub Actions workflow-command syntax: surfaces as a visible
      // annotation even though this job runs continue-on-error (see
      // ci.yml) — the finding stays discoverable without blocking
      // unrelated PRs during the expected core-bump-to-republish window.
      console.log(
        `::warning title=Core pin drift::@dune/${pkg}@${latest}'s pin "${rangeStr}" ` +
          `does not cover core ${coreVersion} yet — bump its @dune/core range and publish a new version.`,
      );
      violations++;
    }
  }

  console.log();
  if (violations > 0) {
    console.error(
      `${violations} pin(s) drifted stale (${skipped} skipped, unreachable). ` +
        `Bump the affected package's @dune/core import range and publish a new version.`,
    );
    Deno.exit(1);
  }
  console.log(
    `check-core-pin-drift: OK${
      skipped > 0 ? ` (${skipped} skipped, unreachable)` : ""
    }`,
  );
}

// Guarded so tests/scripts/check_core_pin_drift_test.ts can import
// extractCoreRange() without triggering live network calls.
if (import.meta.main) {
  await main();
}
