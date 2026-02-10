/**
 * dune serve — Production server (no file watching).
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { join } from "@std/path";
import { bootstrap } from "./bootstrap.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";

export interface ServeOptions {
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

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false } = options;

  console.log("🏜️  Dune — starting production server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, collections, taxonomy, search, imageHandler, adminHandler } = ctx;
  const routes = duneRoutes(engine, collections);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search });
  const adminPrefix = ctx.config.admin?.path ?? "/admin";

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
      if (url.pathname.startsWith(adminPrefix)) {
        const adminResult = await adminHandler(req);
        return adminResult ?? new Response("Not found", { status: 404 });
      }
      if (url.pathname.startsWith("/api/")) {
        return (await apiHandler(req)) ?? new Response(
          JSON.stringify({ error: "Not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/themes/")) {
        return await serveStaticFile(root, url.pathname, ctx.config.theme.name);
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
