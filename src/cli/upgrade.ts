/**
 * dune upgrade — Update @dune/core to the latest version.
 *
 * Reads the site's deno.json, updates the @dune/core import specifier to the
 * latest version published on JSR, and writes the file back. Deno will fetch
 * the new version automatically on the next startup.
 *
 * Usage:
 *   dune upgrade
 */

import { resolve, join, dirname, fromFileUrl } from "@std/path";
import { isNewer, fetchLatestVersion } from "./upgrade-check.ts";

const JSR_META_URL = "https://jsr.io/@dune/core/meta.json";

export interface UpgradeOptions {
  debug?: boolean;
}

export async function upgradeCommand(
  root: string,
  _options: UpgradeOptions = {},
): Promise<void> {
  // Local source — git pull is the upgrade path
  if (import.meta.url.startsWith("file://")) {
    const duneDir = dirname(dirname(fromFileUrl(import.meta.url))); // src/cli/upgrade.ts → repo root

    // Read local version from the repo's own deno.json
    let localVersion: string | null = null;
    try {
      const denoJson = JSON.parse(await Deno.readTextFile(join(duneDir, "deno.json")));
      localVersion = denoJson.version ?? null;
    } catch { /* non-fatal */ }

    // Check JSR for latest
    const latest = await fetchLatestVersion();

    if (localVersion) {
      if (latest && isNewer(latest, localVersion)) {
        console.log(`  ─  You're running Dune ${localVersion} from local source.`);
        console.log(`     Dune ${latest} is available on JSR. To update:`);
      } else {
        console.log(`  ─  You're running Dune ${localVersion} from local source${latest ? " — up to date with JSR" : ""}.`);
        console.log(`     To update to the latest commits:`);
      }
    } else {
      console.log(`  ─  You're running Dune from local source.`);
      console.log(`     To update:`);
    }
    console.log(`       git -C ${duneDir} pull`);
    return;
  }

  root = resolve(root);
  const denoJsonPath = join(root, "deno.json");

  // Read site's deno.json
  let raw: string;
  try {
    raw = await Deno.readTextFile(denoJsonPath);
  } catch {
    console.error(`  ✗ No deno.json found at ${denoJsonPath}`);
    Deno.exit(1);
  }

  console.log("🏜️  Dune — checking for updates...\n");

  // Fetch latest version from JSR
  let latest: string;
  try {
    const res = await fetch(JSR_META_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = await res.json() as { latest?: string };
    if (!meta.latest) throw new Error("No latest version in JSR response");
    latest = meta.latest;
  } catch (err) {
    console.error(`  ✗ Could not fetch latest version: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }

  // Match "@dune/core": "jsr:@dune/core@..." (any specifier form)
  const specRe = /("@dune\/core"\s*:\s*")(jsr:@dune\/core[^"]*)(")/;
  const match = raw.match(specRe);

  if (!match) {
    console.log(`  ─  No @dune/core entry found in ${denoJsonPath}`);
    console.log(`     Add it manually: "@dune/core": "jsr:@dune/core@^${latest}"`);
    return;
  }

  const currentSpec = match[2]; // e.g. "jsr:@dune/core@^0.6"

  // Extract bare version from the current specifier for comparison
  const versionMatch = currentSpec.match(/@([^@"]+)$/);
  const currentVersion = versionMatch ? versionMatch[1].replace(/^\^/, "") : "0.0.0";

  if (!isNewer(latest, currentVersion)) {
    console.log(`  ✅ Already up to date — @dune/core ${currentVersion}`);
    return;
  }

  // Replace with new pinned range
  const newSpec = `jsr:@dune/core@^${latest}`;
  const updated = raw.replace(specRe, `$1${newSpec}$3`);

  await Deno.writeTextFile(denoJsonPath, updated);

  // Invalidate the update-check cache so the notice doesn't re-appear immediately
  try {
    const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
    const xdg = Deno.env.get("XDG_CACHE_HOME");
    const cacheDir = xdg ? `${xdg}/dune` : `${home}/.cache/dune`;
    await Deno.remove(`${cacheDir}/update-check.json`);
  } catch {
    // Cache file absent — no problem
  }

  console.log(`  ✅ @dune/core updated: ${currentSpec} → ${newSpec}`);
  console.log(`\n  Restart your dev server to apply the update.`);
  console.log(`  Deno will fetch the new version automatically on next startup.\n`);
}
