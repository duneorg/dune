/**
 * dune serve — Production server (no file watching).
 *
 * Fresh owns the server and request lifecycle. Dune's content routing, admin
 * panel, plugin hooks, and static file serving are registered as Fresh routes
 * and middleware via createDuneApp(). Island bundles are built once at startup
 * with the Fresh Builder and attached to the same app instance.
 *
 * Multi-site mode delegates to MultisiteManager when config/sites.yaml is
 * present at the installation root.
 */

import { join, resolve } from "@std/path";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { bootstrap } from "./bootstrap.ts";
import { createDuneApp } from "./fresh-app.ts";
import { collectThemeIslands, collectContentIslands } from "../themes/loader.ts";

export interface ServeOptions {
  port?: number;
  debug?: boolean;
}

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false } = options;

  // Resolve root to an absolute path immediately.  The CLI may pass a relative
  // path and we Deno.chdir() later, which would invalidate relative paths.
  root = resolve(root);

  // ── Multi-site detection ────────────────────────────────────────────────────
  // If config/sites.yaml exists at the root, delegate to MultisiteManager.
  // The stat() is isolated in its own try/catch so that any error thrown during
  // multi-site initialisation is NOT silently caught and treated as "not multi-site".
  let isMultisite = false;
  try { await Deno.stat(join(root, "config", "sites.yaml")); isMultisite = true; } catch { /* ok */ }

  if (isMultisite) {
    console.log("🏜️  Dune — starting multi-site production server...\n");
    const { MultisiteManager } = await import("../multisite/mod.ts");
    const manager = new MultisiteManager();
    await manager.init(root, { port, debug, dev: false });
    console.log(`  🌐 http://localhost:${port} (${manager.siteCount()} sites)\n`);
    Deno.serve({ port, handler: (req) => manager.handle(req) });
    return;
  }

  // ── Single site ──────────────────────────────────────────────────────────────
  console.log("🏜️  Dune — starting production server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, config, pluginPublicRoutes } = ctx;
  const adminPrefix = config.admin?.path ?? "/admin";
  const feedEnabled = config.site.feed?.enabled !== false;

  // Collect island paths from plugin public routes so they're included in the bundle.
  const pluginIslandSpecifiers = (pluginPublicRoutes ?? [])
    .map((r) => r.island)
    .filter((p): p is string => typeof p === "string");

  // Collect island paths from the active theme chain (auto-discovery).
  const themeIslandPaths = await collectThemeIslands(
    engine.themes.theme,
    engine.themes.rootDir,
  );

  // Collect island paths imported by TSX content pages (auto-discovery).
  const contentIslandPaths = await collectContentIslands(
    engine.pages,
    root,
    engine.config.system.content.dir,
  );

  // Build island bundles and attach them to the app via the Fresh build cache.
  // Builder scans the theme's islands/ dir; if no islands exist it's a no-op.
  const adminDir = new URL("../admin", import.meta.url).pathname;
  const islandDir = join(adminDir, "islands");
  const routeDir = join(adminDir, "routes");

  // Fresh's esbuild deno plugin (WasmWorkspace) auto-detects the import map by
  // walking up from Deno.cwd() — it ignores esbuild's absWorkingDir entirely.
  // Chdir to the dune package root before building so WasmWorkspace finds
  // dune's deno.json (with explicit preact/hooks, preact/jsx-dev-runtime entries).
  // root is already absolute, so the chdir cannot invalidate any paths.
  const duneRoot = new URL("../../", import.meta.url).pathname;
  Deno.chdir(duneRoot);

  const allIslandSpecifiers = [...pluginIslandSpecifiers, ...themeIslandPaths, ...contentIslandPaths];
  const builder = new Builder({
    root,
    islandDir,
    routeDir,
  });

  // Builder's constructor has no `islandSpecifiers` option — register them
  // explicitly via registerIsland() after construction.
  for (const spec of allIslandSpecifiers) {
    builder.registerIsland(spec);
  }
  const applySnapshot = await builder.build({ mode: "production", snapshot: "memory" });

  // Assemble the Fresh app with all Dune routes as middleware.
  const { app } = await createDuneApp(ctx, { root, port, debug, dev: false });

  // Attach the island build cache so staticFiles() can serve /_fresh/js/* chunks.
  applySnapshot(app);

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🗺️  Sitemap generated`);
  if (feedEnabled) console.log(`  📡 RSS + Atom feeds generated`);
  console.log(`  🔐 Admin panel: http://localhost:${port}${adminPrefix}/`);
  console.log(`  🌐 http://localhost:${port}\n`);

  Deno.serve({ port, handler: app.handler() });
}
