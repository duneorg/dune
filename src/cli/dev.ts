/**
 * dune dev — Development server with file watching and hot-reload.
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { join } from "@std/path";
import { bootstrap } from "./bootstrap.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";

export interface DevOptions {
  port?: number;
  debug?: boolean;
}

/**
 * Serve static files from the site's static directory or theme static directories.
 */
async function serveStaticFile(root: string, pathname: string, themeName?: string): Promise<Response> {
  // Check for theme static files first: /themes/{theme}/static/*
  if (pathname.startsWith("/themes/") && pathname.includes("/static/")) {
    const themeMatch = pathname.match(/^\/themes\/([^/]+)\/static\/(.+)$/);
    if (themeMatch) {
      const [, theme, filePath] = themeMatch;
      const fullPath = join(root, "themes", theme, "static", filePath);
      
      try {
        // Security: prevent directory traversal
        if (filePath.includes("..") || filePath.startsWith("/")) {
          return new Response("Not found", { status: 404 });
        }

        const file = await Deno.readFile(fullPath);
        const stat = await Deno.stat(fullPath);
        return createFileResponse(file, stat.size, fullPath);
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  }

  // Fall back to site static directory: /static/*
  const filePath = pathname.replace(/^\/static\//, "");
  const fullPath = join(root, "static", filePath);

  try {
    // Security: prevent directory traversal
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return new Response("Not found", { status: 404 });
    }

    const file = await Deno.readFile(fullPath);
    const stat = await Deno.stat(fullPath);
    return createFileResponse(file, stat.size, fullPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Create a Response with appropriate headers for a file.
 */
function createFileResponse(file: Uint8Array, size: number, fullPath: string): Response {
  // Determine content type from extension
  const ext = fullPath.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = {
    // Fonts
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    eot: "application/vnd.ms-fontobject",
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    // Text
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    txt: "text/plain",
    xml: "application/xml",
    // Other
    pdf: "application/pdf",
  };

  return new Response(file, {
    headers: {
      "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function devCommand(root: string, options: DevOptions = {}) {
  const { port = 3000, debug = false } = options;

  console.log("🏜️  Dune — starting development server...\n");

  // Bootstrap engine
  const ctx = await bootstrap(root, { debug, buildSearch: true });

  const { engine, collections, taxonomy, search, imageHandler, adminHandler } = ctx;
  const routes = duneRoutes(engine, collections);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search });
  const adminPrefix = ctx.config.admin?.path ?? "/admin";

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);
  console.log(`  🔍 Search index built`);
  console.log(`  🔐 Admin panel: http://localhost:${port}${adminPrefix}/`);

  // JSX renderer
  const renderJsx = (jsx: unknown, statusCode = 200) => {
    const html = render(jsx as any);
    return new Response(`<!DOCTYPE html>${html}`, {
      status: statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  // Start file watcher
  const contentDir = `${root}/${engine.config.system.content.dir}`;
  const themesDir = `${root}/themes`;

  let watchPaths: string[];
  try {
    watchPaths = [contentDir];
    try {
      await Deno.stat(themesDir);
      watchPaths.push(themesDir);
    } catch {
      // No themes dir
    }

    const watcher = Deno.watchFs(watchPaths);
    console.log(`  👀 Watching: ${watchPaths.join(", ")}`);

    // Debounced rebuild
    let rebuildTimeout: number | undefined;
    (async () => {
      for await (const event of watcher) {
        if (event.kind === "modify" || event.kind === "create" || event.kind === "remove") {
          clearTimeout(rebuildTimeout);
          rebuildTimeout = setTimeout(async () => {
            const start = performance.now();
            await engine.rebuild();
            taxonomy.rebuild(engine.pages, engine.taxonomyMap);
            collections.rebuild(engine.pages, engine.taxonomyMap);
            await search.rebuild(engine.pages);
            const elapsed = (performance.now() - start).toFixed(0);
            console.log(`  🔄 Rebuilt in ${elapsed}ms (${engine.pages.length} pages)`);
          }, 200);
        }
      }
    })();
  } catch {
    console.log(`  ⚠️  File watching not available — changes require restart`);
  }

  // Request handler
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const start = performance.now();

    let response: Response;

    try {
      // Admin routes (must come before content routes)
      if (url.pathname.startsWith(adminPrefix)) {
        const adminResult = await adminHandler(req);
        response = adminResult ?? new Response("Not found", { status: 404 });
      }
      // API routes
      else if (url.pathname.startsWith("/api/")) {
        const apiResult = await apiHandler(req);
        response = apiResult ?? new Response(
          JSON.stringify({ error: "Not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      // Static files (must come before content routes)
      else if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/themes/")) {
        response = await serveStaticFile(root, url.pathname, ctx.config.theme.name);
      }
      // Media routes (image processing first, then raw media)
      else if (url.pathname.startsWith("/content-media/")) {
        const imageResult = await imageHandler(req);
        response = imageResult ?? await routes.mediaHandler(req);
      }
      // Content routes
      else {
        response = await routes.contentHandler(req, renderJsx);
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err}`);
      response = new Response("Internal Server Error", { status: 500 });
    }

    const elapsed = (performance.now() - start).toFixed(0);
    if (debug) {
      console.log(`  ${response.status} ${url.pathname} (${elapsed}ms)`);
    }

    return response;
  };

  console.log(`\n  🌐 http://localhost:${port}\n`);

  Deno.serve({ port, handler });
}
