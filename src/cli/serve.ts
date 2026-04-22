/**
 * dune serve — Production server (no file watching).
 *
 * Features:
 *   - Security headers (CSP, X-Frame-Options, etc.)
 *   - Gzip compression for text-based responses
 *   - Cache-aware static file serving (long-lived for fonts/images, short for HTML)
 *   - Auto-generated /sitemap.xml from content index
 *   - /health endpoint for monitoring
 *   - Custom 404/500 error pages rendered through the theme
 *   - Multi-site mode when config/sites.yaml is present at the installation root
 */

import { join } from "@std/path";
import { App, staticFiles } from "fresh";
import { bootstrap } from "./bootstrap.ts";
import { buildSitePrebuilt, createProductionSiteHandler } from "./site-handler.ts";
import type { RenderJsx } from "./site-handler.ts";
import { buildIslands } from "./islands.ts";

export interface ServeOptions {
  port?: number;
  debug?: boolean;
}

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false } = options;

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
  const { engine } = ctx;

  const prebuilt = await buildSitePrebuilt(ctx, port);
  const handler = createProductionSiteHandler(ctx, prebuilt, root, { port, debug });

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🗺️  Sitemap generated`);
  if (prebuilt.feedEnabled) console.log(`  📡 RSS + Atom feeds generated`);
  console.log(`  🌐 http://localhost:${port}\n`);

  const app = new App();
  await buildIslands(app, root, ctx.config.theme.name, "production");
  app.use(staticFiles());
  app.get("/*", async (freshCtx) => {
    const rj: RenderJsx = (vnode, _s = 200) =>
      freshCtx.render(vnode as Parameters<typeof freshCtx.render>[0]);
    return handler(freshCtx.req, rj);
  });
  const freshHandler = app.handler();
  Deno.serve({
    port,
    handler: (req) => req.method === "GET" || req.method === "HEAD"
      ? freshHandler(req)
      : handler(req),
  });
}
