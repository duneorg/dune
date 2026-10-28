/**
 * dune upgrade — Update @dune/core to the latest version.
 *
 * Reads the site's deno.json and moves every `jsr:@dune/core@…` reference to
 * the target version: the `@dune/core` import, its subpath entries (e.g.
 * `@dune/core/ui/editable`) and the CLI specifier in legacy `tasks`. Each
 * reference keeps its own style (exact `0.35.1`, caret `^0.35.1`, or a partial
 * `0.35`), so a site that pins exactly stays pinned exactly. Then it syncs the
 * lockfile. Deno fetches the new version on the next startup.
 *
 * Usage:
 *   dune upgrade [version]    # default: latest on JSR
 */

import { resolve, join, dirname, fromFileUrl } from "@std/path";
import { isNewer, fetchLatestVersion } from "./upgrade-check.ts";
import { lockfileSyncCommand } from "./lockfile.ts";

const JSR_META_URL = "https://jsr.io/@dune/core/meta.json";

export interface UpgradeOptions {
  debug?: boolean;
  /** Target version; defaults to the latest published on JSR. */
  version?: string;
}

/** One `jsr:@dune/core@…` reference that was (or would be) rewritten. */
export interface CoreRefChange {
  from: string;
  to: string;
}

/**
 * Rewrite every `jsr:@dune/core@<version>` reference in a deno.json text to
 * `version`, keeping each reference's own style: a `^`/`~` prefix and the
 * number of version segments (`0.34.13` -> exact, `^0.35` -> caret + minor).
 * References that already point at `version` (or, unless `force`, at something
 * newer) are left alone. JSON keys (`"jsr:@dune/core@^0.34": …`) are never
 * touched, only values and task commands. Text-based, so formatting survives.
 */
export function rewriteCoreRefs(
  raw: string,
  version: string,
  force = false,
): { updated: string; changes: CoreRefChange[] } {
  const changes: CoreRefChange[] = [];
  const re = /jsr:@dune\/core@(\^|~)?(\d+(?:\.\d+){0,2})/g;
  const updated = raw.replace(re, (match, prefix: string | undefined, ver: string, offset: number) => {
    // Skip JSON keys: the enclosing string is followed by a colon.
    const close = raw.indexOf('"', offset + match.length);
    if (close !== -1 && /^\s*:/.test(raw.slice(close + 1, close + 40))) return match;
    if (!force && !isNewer(version, ver)) return match;
    const segments = ver.split(".").length;
    const next = version.split(".").slice(0, segments).join(".");
    const to = `jsr:@dune/core@${prefix ?? ""}${next}`;
    if (to !== match) changes.push({ from: match, to });
    return to;
  });
  return { updated, changes };
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
    console.log(`\n  To update Dune's own dependencies (Fresh, @std/*, etc.):`);
    console.log(`       deno outdated --update --directory ${duneDir}`);
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

  // Target version: explicit argument, or the latest published on JSR
  let target: string;
  if (_options.version) {
    target = _options.version.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(target)) {
      console.error(`  ✗ "${_options.version}" is not a full version (expected e.g. 0.35.1)`);
      Deno.exit(1);
    }
  } else {
    try {
      const res = await fetch(JSR_META_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json() as { latest?: string };
      if (!meta.latest) throw new Error("No latest version in JSR response");
      target = meta.latest;
    } catch (err) {
      console.error(`  ✗ Could not fetch latest version: ${err instanceof Error ? err.message : err}`);
      Deno.exit(1);
    }
  }

  if (!/jsr:@dune\/core@/.test(raw)) {
    console.log(`  ─  No @dune/core entry found in ${denoJsonPath}`);
    console.log(`     Add it manually: "@dune/core": "jsr:@dune/core@${target}"`);
    return;
  }

  const { updated, changes } = rewriteCoreRefs(raw, target, _options.version !== undefined);

  if (changes.length === 0) {
    console.log(`  ✅ Already up to date — @dune/core ${target}`);
    return;
  }

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

  console.log(`  ✅ @dune/core updated to ${target} (${changes.length} reference${changes.length === 1 ? "" : "s"}):`);
  for (const c of changes) console.log(`       ${c.from} → ${c.to}`);

  // The CLI specifier in tasks (jsr:@dune/core@X/cli) is a separate re-exec path
  // that bypasses the import map; the entrypoint pattern has a single pin.
  if (/jsr:@dune\/core@[^"\s]*\/cli/.test(updated)) {
    console.log(`\n  💡 This site still launches through a versioned CLI specifier in its tasks.`);
    console.log(`     \`dune migrate:entrypoint\` moves it to the single-pin entrypoint pattern.`);
  }
  console.log(`  💡 Plugin versions are separate: \`dune plugin:update\` bumps the ones in site.yaml.`);

  console.log(`\n  🔒 Syncing lockfile...`);
  try {
    await lockfileSyncCommand(root, {});
    console.log(`\n  Commit deno.lock along with deno.json before deploying.\n`);
  } catch {
    console.log(`  ⚠  Lockfile sync failed — run \`dune lockfile:sync\` manually before deploying.\n`);
  }
}
