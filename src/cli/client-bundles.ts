/**
 * Plugin client-entry bundling.
 *
 * Plugins can declare browser code via `DunePlugin.clientEntries` — a map of
 * entry name → module specifier. At app startup each entry is bundled for
 * the browser with `deno bundle` (which resolves the plugin's own npm/jsr
 * dependency graph, so e.g. an editor plugin's TipTap packages never appear
 * anywhere outside that plugin) and served at
 * `/plugins/{plugin-name}/{entry}.js`.
 *
 * Bundles are cached on disk in `{root}/.dune/client-bundles/`, keyed by
 * plugin name + version + entry name. In production a cached bundle is
 * reused; in dev mode entries are re-bundled at every startup so local
 * plugin development picks up changes.
 */

import { join } from "@std/path";
import type { DunePlugin } from "../hooks/types.ts";
import { logger } from "../core/logger.ts";

/** A bundled client entry ready to serve. */
export interface ClientBundle {
  /** Bundled JavaScript (ESM, browser platform). */
  code: Uint8Array<ArrayBuffer>;
  /** Quoted ETag derived from a SHA-256 hash of the bundled bytes. */
  etag: string;
}

/** Sanitize a name for use in a cache filename. */
function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/**
 * Cache filename for a (plugin, version, entry) triple.
 *
 * The sanitized `name-version-entry` prefix is for human readability only —
 * it is ambiguous (`-` is legal inside each component, and `safeName`
 * collapses distinct characters to `_`), so uniqueness comes from a hash of
 * the raw triple joined with NUL, which cannot appear in any component.
 * Without the hash, plugin `foo` @ `1.0.0-beta` entry `x` and plugin
 * `foo-1.0.0` @ `beta` entry `x` would share a cache file and be served
 * each other's code.
 */
async function cacheFileName(name: string, version: string, entry: string): Promise<string> {
  const raw = new TextEncoder().encode(`${name}\u0000${version}\u0000${entry}`);
  const hash = await crypto.subtle.digest("SHA-256", raw);
  const hex = Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${safeName(name)}-${safeName(version)}-${safeName(entry)}-${hex}.js`;
}

/**
 * Quoted ETag from a SHA-256 content hash (same shape as page ETags in
 * `src/cache/etag.ts`). Content-derived so a rebuild that changes the
 * output — dev-mode edits, runtime/bundler upgrades — invalidates browser
 * caches even when the plugin version is unchanged. Identity (name,
 * version, entry) is only used for the disk-cache key, never as the
 * freshness validator.
 */
async function contentEtag(code: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", code);
  const hex = Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

async function bundleEntry(specifier: string, outFile: string): Promise<void> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--minify",
      "--quiet",
      "--output",
      outFile,
      specifier,
    ],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr).trim() || `deno bundle exited with ${code}`);
  }
}

/**
 * Bundle all plugin client entries and return a map keyed by
 * `{plugin-name}/{entry}.js` (the path under `/plugins/`).
 *
 * Bundling failures are logged and skipped — the rest of the app starts
 * normally; only the failing entry's URL will 404.
 */
export async function buildPluginClientBundles(
  plugins: DunePlugin[],
  opts: { root: string; dev: boolean },
): Promise<Map<string, ClientBundle>> {
  const bundles = new Map<string, ClientBundle>();
  const withEntries = plugins.filter((p) => p.clientEntries && Object.keys(p.clientEntries).length > 0);
  if (withEntries.length === 0) return bundles;

  const cacheDir = join(opts.root, ".dune", "client-bundles");
  await Deno.mkdir(cacheDir, { recursive: true });

  for (const plugin of withEntries) {
    for (const [entry, specifier] of Object.entries(plugin.clientEntries!)) {
      const key = `${plugin.name}/${entry}.js`;
      const cacheFile = join(cacheDir, await cacheFileName(plugin.name, plugin.version, entry));
      try {
        let code: Uint8Array<ArrayBuffer> | null = null;
        if (!opts.dev) {
          try {
            code = await Deno.readFile(cacheFile);
          } catch { /* cache miss — bundle below */ }
        }
        if (!code) {
          const started = performance.now();
          await bundleEntry(specifier, cacheFile);
          code = await Deno.readFile(cacheFile);
          logger.info("plugin.client_entry.bundled", {
            plugin: plugin.name,
            entry,
            bytes: code.byteLength,
            ms: Math.round(performance.now() - started),
          });
        }
        bundles.set(key, { code, etag: await contentEtag(code) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("plugin.client_entry.bundle_failed", {
          plugin: plugin.name,
          entry,
          specifier,
          error: message,
        });
      }
    }
  }
  return bundles;
}

/**
 * Serve a bundled client entry for a `/plugins/{name}/{entry}.js` request,
 * or null when the path is not a known bundle (falls through to static
 * plugin assets).
 */
export function serveClientBundle(
  bundles: Map<string, ClientBundle>,
  pathname: string,
  req: Request,
  dev: boolean,
): Response | null {
  const match = pathname.match(/^\/plugins\/(.+)$/);
  if (!match) return null;
  const bundle = bundles.get(match[1]);
  if (!bundle) return null;

  const headers: Record<string, string> = {
    "Content-Type": "text/javascript; charset=utf-8",
    "ETag": bundle.etag,
    "Cache-Control": dev ? "no-cache" : "public, max-age=3600",
  };
  if (req.headers.get("if-none-match") === bundle.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bundle.code, { headers });
}
