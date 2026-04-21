/**
 * dune dev — Development server with file watching and live-reload.
 *
 * Features:
 *   - Watches content/ and themes/ for changes
 *   - Rebuilds index, taxonomy, collections, search on file changes
 *   - SSE-based live reload: browser auto-refreshes after rebuild
 *   - Template cache busting: theme/layout changes take effect immediately
 *   - Multi-site mode when config/sites.yaml is present at the installation root
 */

import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "./bootstrap.ts";
import { createDevSiteContext } from "./site-handler.ts";
import type { RenderJsx } from "./site-handler.ts";

export interface DevOptions {
  port?: number;
  debug?: boolean;
}

export async function devCommand(root: string, options: DevOptions = {}) {
  const { port = 3000, debug = false } = options;

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
  const { engine, collections, taxonomy, search } = ctx;
  const adminPrefix = ctx.config.admin?.path ?? "/admin";

  const siteCtx = createDevSiteContext(ctx, root, { port, debug });

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);
  console.log(`  🔍 Search index built`);
  console.log(`  🔐 Admin panel: http://localhost:${port}${adminPrefix}/`);

  // ── File watcher ─────────────────────────────────────────────────────────────
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
              siteCtx.notifyReload();
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

  const app = new App().get("/*", async (freshCtx) => {
    const rj: RenderJsx = (vnode, _s = 200) =>
      freshCtx.render(vnode as Parameters<typeof freshCtx.render>[0]);
    return siteCtx.handler(freshCtx.req, rj);
  });
  const freshHandler = app.handler();
  Deno.serve({
    port,
    handler: (req) => req.method === "GET" || req.method === "HEAD"
      ? freshHandler(req)
      : siteCtx.handler(req),
  });
}
