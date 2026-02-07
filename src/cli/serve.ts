/**
 * dune serve — Production server (no file watching).
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { bootstrap } from "./bootstrap.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";

export interface ServeOptions {
  port?: number;
  debug?: boolean;
}

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false } = options;

  console.log("🏜️  Dune — starting production server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, collections, taxonomy, search, imageHandler } = ctx;
  const routes = duneRoutes(engine);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search });

  console.log(`  📄 ${engine.pages.length} pages indexed`);

  const renderJsx = (jsx: unknown, statusCode = 200) => {
    const html = render(jsx as any);
    return new Response(`<!DOCTYPE html>${html}`, {
      status: statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return (await apiHandler(req)) ?? new Response(
          JSON.stringify({ error: "Not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.startsWith("/content-media/")) {
        const imageResult = await imageHandler(req);
        return imageResult ?? await routes.mediaHandler(req);
      }
      return await routes.contentHandler(req, renderJsx);
    } catch (err) {
      console.error(`✗ Error: ${err}`);
      return new Response("Internal Server Error", { status: 500 });
    }
  };

  console.log(`  🌐 http://localhost:${port}\n`);

  Deno.serve({ port, handler });
}
