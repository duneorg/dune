/**
 * Dune docs site — entry point.
 *
 * Boots the DuneEngine against the docs/ content directory,
 * registers all routes with Fresh 2, and starts serving.
 *
 * Usage: deno run -A docs/main.ts
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { createStorage } from "../src/storage/mod.ts";
import { loadConfig } from "../src/config/loader.ts";
import { FormatRegistry } from "../src/content/formats/registry.ts";
import { MarkdownHandler } from "../src/content/formats/markdown.ts";
import { TsxHandler } from "../src/content/formats/tsx.ts";
import { createDuneEngine } from "../src/core/engine.ts";
import { duneRoutes } from "../src/routing/routes.ts";

const PORT = parseInt(Deno.env.get("PORT") ?? "3000");

async function main() {
  console.log("[dune] Starting docs site...");

  // 1. Create storage adapter rooted at docs/
  const storage = createStorage({ rootDir: "docs" });

  // 2. Load config from docs/config/
  const config = await loadConfig({
    storage,
    rootDir: "docs",
    skipConfigTs: true,
  });
  config.system.debug = true;
  config.system.content.dir = "content";

  // 3. Register format handlers
  const formats = new FormatRegistry();
  formats.register(new MarkdownHandler());
  formats.register(new TsxHandler());

  // 4. Create and initialize the engine
  const engine = await createDuneEngine({
    storage,
    config,
    formats,
    themesDir: "themes",
    storageRoot: "docs",
  });
  await engine.init();

  console.log(`[dune] Content index: ${engine.pages.length} pages`);
  console.log(`[dune] Theme: ${engine.themes.theme.manifest.name}`);
  console.log(`[dune] Templates: ${engine.themes.getAvailableTemplates().join(", ")}`);

  // 5. Set up route handlers
  const routes = duneRoutes(engine);

  // 6. Simple HTTP server (no Fresh dependency for now — pure Deno.serve)
  // This proves the engine works end-to-end. Fresh integration comes next.
  console.log(`[dune] Listening on http://localhost:${PORT}`);

  Deno.serve({ port: PORT }, async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // Media files
      if (path.startsWith("/content-media/")) {
        return await routes.mediaHandler(req);
      }

      // API routes
      if (path.startsWith("/api/")) {
        return await routes.apiHandler(req);
      }

      // Favicon
      if (path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      // Content route — render JSX to HTML string
      const renderJsx = (jsx: unknown, statusCode = 200) => {
        const html = render(jsx as any);
        return new Response(`<!DOCTYPE html>${html}`, {
          status: statusCode,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      };

      return await routes.contentHandler(req, renderJsx);
    } catch (err) {
      console.error(`[dune] Error handling ${path}:`, err);
      return new Response(`Internal Server Error: ${err}`, { status: 500 });
    }
  });
}

main().catch((err) => {
  console.error("[dune] Fatal error:", err);
  Deno.exit(1);
});
