/**
 * dune dev — Development server with file watching and live-reload.
 *
 * Fresh owns the server via builder.listen(), which handles island bundling,
 * JS live reload (/_fresh_live_reload), and the dev error overlay.
 *
 * Dune's content watcher runs alongside and calls notifyReload() after each
 * rebuild, which pushes a reload event via the /__dune_reload SSE endpoint
 * registered inside createDuneApp().
 *
 * Multi-site mode delegates to MultisiteManager when config/sites.yaml is
 * present at the installation root.
 */

import { join, resolve } from "@std/path";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { bootstrap } from "./bootstrap.ts";
import { createDuneApp } from "./fresh-app.ts";
import { collectThemeIslands, collectContentIslands } from "../themes/loader.ts";
import { isValidPluginIslandSpecifier } from "../plugins/loader.ts";

export interface DevOptions {
  port?: number;
  debug?: boolean;
}

export async function devCommand(root: string, options: DevOptions = {}) {
  const { port = 3000, debug = false } = options;

  // Resolve root to an absolute path immediately.  The CLI may pass a relative
  // path (e.g. "zumbrunn/zumbrunn.com") and we Deno.chdir() later, which would
  // invalidate any relative paths computed against the original cwd.
  root = resolve(root);

  // Disable Secure cookie flag in dev so session cookies work over plain HTTP.
  // Without this, browsers (particularly Safari) reject the Secure cookie on
  // localhost and every login redirects back to the login page silently.
  Deno.env.set("DUNE_ENV", "dev");

  // ── Multi-site detection ────────────────────────────────────────────────────
  let isMultisite = false;
  try { await Deno.stat(join(root, "config", "sites.yaml")); isMultisite = true; } catch { /* ok */ }

  if (isMultisite) {
    console.log("🏜️  Dune — starting multi-site dev server...\n");
    const { MultisiteManager } = await import("../multisite/mod.ts");
    const manager = new MultisiteManager();
    await manager.init(root, { port, debug, dev: true });
    console.log(`\n  🌐 http://localhost:${port} (${manager.siteCount()} sites)\n`);
    Deno.serve({ port, handler: (req) => manager.handle(req) });
    return;
  }

  // ── Single site ──────────────────────────────────────────────────────────────
  console.log("🏜️  Dune — starting development server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, collections, taxonomy, search, config, pluginPublicRoutes } = ctx;
  const adminPrefix = config.admin?.path ?? "/admin";

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);
  console.log(`  🔍 Search index built`);
  console.log(`  🔐 Admin panel: http://localhost:${port}${adminPrefix}/`);

  // ── Content file watcher ─────────────────────────────────────────────────────
  // notifyReload comes from createDuneApp (called inside builder.listen below).
  // We use a shared mutable reference so the watcher can call it once it is set.
  let notifyContentReload: () => void = () => {};

  const contentDir = `${root}/${engine.config.system.content.dir}`;
  const themesDir = `${root}/themes`;
  const flexObjectsDir = `${root}/flex-objects`;

  try {
    const watchPaths: string[] = [contentDir];
    try { await Deno.stat(themesDir); watchPaths.push(themesDir); } catch { /* no themes dir */ }
    try { await Deno.stat(flexObjectsDir); watchPaths.push(flexObjectsDir); } catch { /* no flex-objects dir yet */ }

    const watcher = Deno.watchFs(watchPaths);
    console.log(`  👀 Watching: ${watchPaths.join(", ")}`);
    console.log(`  ⚡ Live reload enabled`);

    // Debounced rebuild — coalesces rapid file-system events into one rebuild
    let rebuildTimeout: number | undefined;
    (async () => {
      for await (const event of watcher) {
        if (event.kind === "modify" || event.kind === "create" || event.kind === "remove") {
          clearTimeout(rebuildTimeout);
          rebuildTimeout = setTimeout(async () => {
            try {
              const start = performance.now();
              await engine.rebuild();
              taxonomy.rebuild(engine.pages, engine.taxonomyMap);
              collections.rebuild(engine.pages, engine.taxonomyMap);
              await search.rebuild(engine.pages);
              const elapsed = (performance.now() - start).toFixed(0);
              console.log(`  🔄 Rebuilt in ${elapsed}ms (${engine.pages.length} pages)`);
              notifyContentReload();
            } catch (err) {
              console.error(`  ✗ Rebuild error: ${err}`);
            }
          }, 200);
        }
      }
    })();
  } catch {
    console.log(`  ⚠️  File watching not available — changes require restart`);
  }

  console.log(`\n  🌐 http://localhost:${port}\n`);

  // ── Fresh dev server ─────────────────────────────────────────────────────────
  // builder.listen() handles island bundling in watch mode, the
  // /_fresh_live_reload SSE endpoint (for island JS changes), and the dev error
  // overlay. createDuneApp() adds Dune's /__dune_reload SSE endpoint (for
  // content changes) and all other routes.
  const adminDir = new URL("../admin", import.meta.url).pathname;
  const islandDir = join(adminDir, "islands");
  const routeDir = join(adminDir, "routes");

  // Collect island paths from plugin public routes. Validate before
  // handing to Builder so a plugin can't name a path with `..` that
  // escapes the workspace root (HIGH-19).
  const pluginIslandSpecifiers = (pluginPublicRoutes ?? [])
    .map((r) => r.island)
    .filter((p): p is string => {
      if (!isValidPluginIslandSpecifier(p)) {
        if (p !== undefined) {
          console.warn(`[dune] plugin island rejected (invalid path): ${JSON.stringify(p)}`);
        }
        return false;
      }
      return true;
    });

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

  // Fresh's esbuild deno plugin (WasmWorkspace) auto-detects the import map by
  // walking up from Deno.cwd() — it ignores esbuild's absWorkingDir entirely.
  // When users run `dune dev --root ./mysite` from an arbitrary directory, cwd
  // has no deno.json, so preact/hooks and preact/jsx-dev-runtime are not found.
  // Fix: chdir to the dune package root (which has the full deno.json) before
  // creating the builder.  root is already absolute, so this is safe.
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

  await builder.listen(async () => {
    const { app, notifyReload } = await createDuneApp(ctx, { root, port, debug, dev: true });
    // Wire the content watcher's notifyReload reference now that the app is built.
    notifyContentReload = notifyReload;
    return app;
  }, { port });
}
