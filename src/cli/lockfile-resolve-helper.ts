/**
 * Internal worker for `dune lockfile sync` / `dune lockfile check`.
 *
 * Not a public CLI command. Spawned as a subprocess with an explicit
 * `--lock=<scratch-copy>` (and the site's `--config=`), so that loading
 * config and importing each configured plugin — which transitively resolves
 * and writes server-side npm/jsr dependencies into whichever lockfile is
 * active — only ever touches the scratch copy, never the project's real
 * `deno.lock`. The parent process (lockfile.ts) diffs the scratch result
 * against the original and merges additively.
 *
 * Browser-side `clientEntries` specifiers are deliberately *not* resolved
 * here: actually importing a browser-targeted module would execute its
 * top-level code in this (server) process, which can throw on DOM globals.
 * This script only discovers and prints the entry specifier strings; the
 * parent does the safe `deno cache <specifier>` pass for those (mirroring
 * how `client-bundles.ts` resolves them — caching, never executing).
 *
 * Prints one line of JSON to stdout:
 *   { "pluginSpecifiers": string[], "clientEntrySpecifiers": string[] }
 */

import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import { loadPlugins } from "../plugins/loader.ts";

const root = Deno.args[0] ?? ".";

const storage = createStorage({ rootDir: root });
const config = await loadConfig({ storage, rootDir: root, skipConfigTs: false });
const hooks = createHookRegistry({ config, storage });
await loadPlugins({ config, hooks, storage, root });

// Only registry specifiers need their dependency graph cached — local
// ("./..." or "/...") plugins have no npm/jsr deps of their own to resolve.
const pluginSpecifiers = config.pluginList
  .map((p) => p.src)
  .filter((src) => src.startsWith("jsr:") || src.startsWith("npm:") || src.startsWith("https:"));

const clientEntrySpecifiers: string[] = [];
for (const plugin of hooks.plugins()) {
  if (!plugin.clientEntries) continue;
  for (const specifier of Object.values(plugin.clientEntries)) {
    clientEntrySpecifiers.push(specifier);
  }
}

console.log(JSON.stringify({ pluginSpecifiers, clientEntrySpecifiers }));
