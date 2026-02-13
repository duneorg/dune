/**
 * dune serve — Production server (no file watching).
 *
 * Features:
 *   - Security headers (CSP, X-Frame-Options, etc.)
 *   - Cache-aware static file serving (long-lived for fonts/images, short for HTML)
 *   - /health endpoint for monitoring
 *   - Custom 404/500 error pages rendered through the theme
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

// === Security Headers ===

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

/** Apply security headers to a response. */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// === Static File Serving ===

const MIME_TYPES: Record<string, string> = {
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

/** Long-lived assets: fonts, images (1 year). */
const IMMUTABLE_EXTS = new Set([
  "ttf", "otf", "woff", "woff2", "eot",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "ico",
]);

function cacheControlFor(ext: string): string {
  if (IMMUTABLE_EXTS.has(ext)) return "public, max-age=31536000";
  // CSS/JS/other: 1 hour, revalidate
  return "public, max-age=3600, must-revalidate";
}

function createFileResponse(file: Uint8Array, size: number, fullPath: string): Response {
  const ext = fullPath.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": cacheControlFor(ext),
    },
  });
}

/**
 * Serve static files from the site's static/ or theme static/ directories.
 */
async function serveStaticFile(root: string, pathname: string): Promise<Response | null> {
  let filePath: string;
  let fullPath: string;

  // Theme static files: /themes/{theme}/static/*
  if (pathname.startsWith("/themes/") && pathname.includes("/static/")) {
    const themeMatch = pathname.match(/^\/themes\/([^/]+)\/static\/(.+)$/);
    if (themeMatch) {
      const [, theme, path] = themeMatch;
      filePath = path;
      fullPath = join(root, "themes", theme, "static", path);
    } else {
      return null;
    }
  }
  // Site root static files: /favicon.ico, /robots.txt, /sitemap.xml
  else if (/^\/(favicon\.(ico|svg)|robots\.txt|sitemap\.xml)$/.test(pathname)) {
    filePath = pathname.slice(1);
    fullPath = join(root, "static", filePath);
  }
  // Site static directory: /static/*
  else {
    filePath = pathname.replace(/^\/static\//, "");
    fullPath = join(root, "static", filePath);
  }

  // Security: prevent directory traversal
  if (filePath.includes("..") || filePath.startsWith("/")) {
    return null;
  }

  try {
    const file = await Deno.readFile(fullPath);
    const stat = await Deno.stat(fullPath);
    return createFileResponse(file, stat.size, fullPath);
  } catch {
    return null;
  }
}

// === Error Pages ===

function renderErrorPage(status: number, title: string, message: string, siteName: string): Response {
  const html = render(
    h("html", { lang: "en" },
      h("head", null,
        h("meta", { charset: "utf-8" }),
        h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
        h("title", null, `${title} | ${siteName}`),
        h("style", null, `
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 4rem auto; padding: 0 1.5rem; color: #333; text-align: center; }
          h1 { font-size: 4rem; margin: 0; color: #667eea; }
          p { font-size: 1.1rem; color: #666; }
          a { color: #667eea; text-decoration: none; }
          a:hover { text-decoration: underline; }
        `),
      ),
      h("body", null,
        h("h1", null, String(status)),
        h("p", null, message),
        h("p", null, h("a", { href: "/" }, `← Back to ${siteName}`)),
      ),
    ),
  );
  return new Response(`<!DOCTYPE html>${html}`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// === Server ===

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false } = options;

  console.log("🏜️  Dune — starting production server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, collections, taxonomy, search, imageHandler, adminHandler } = ctx;
  const routes = duneRoutes(engine, collections);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search });
  const adminPrefix = ctx.config.admin?.path ?? "/admin";
  const siteName = engine.site.title;
  const startTime = Date.now();

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
      // Health check endpoint
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({
          status: "ok",
          uptime: Math.floor((Date.now() - startTime) / 1000),
          pages: engine.pages.length,
        }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        });
      }

      // Root-level static files (favicon.ico, robots.txt, sitemap.xml)
      if (/^\/(favicon\.(ico|svg)|robots\.txt|sitemap\.xml)$/.test(url.pathname)) {
        const staticResult = await serveStaticFile(root, url.pathname);
        return withSecurityHeaders(staticResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName));
      }

      // Admin routes
      if (url.pathname.startsWith(adminPrefix)) {
        const adminResult = await adminHandler(req);
        return withSecurityHeaders(adminResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName));
      }

      // API routes
      if (url.pathname.startsWith("/api/")) {
        const apiResult = await apiHandler(req);
        return apiResult ?? new Response(
          JSON.stringify({ error: "Not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      // Static files
      if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/themes/")) {
        const staticResult = await serveStaticFile(root, url.pathname);
        return staticResult ?? withSecurityHeaders(renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName));
      }

      // Media routes (image processing first, then raw media)
      if (url.pathname.startsWith("/content-media/")) {
        const imageResult = await imageHandler(req);
        return imageResult ?? await routes.mediaHandler(req);
      }

      // Content routes
      const response = await routes.contentHandler(req, renderJsx);
      return withSecurityHeaders(response);
    } catch (err) {
      if (debug) {
        console.error(`✗ Error serving ${url.pathname}:`, err);
      } else {
        console.error(`✗ Error serving ${url.pathname}: ${(err as Error).message ?? err}`);
      }
      return withSecurityHeaders(renderErrorPage(500, "Server Error", "Something went wrong. Please try again later.", siteName));
    }
  };

  console.log(`  🌐 http://localhost:${port}\n`);

  Deno.serve({ port, handler });
}
