/**
 * dune dev — Development server with file watching and live-reload.
 *
 * Features:
 *   - Watches content/ and themes/ for changes
 *   - Rebuilds index, taxonomy, collections, search on file changes
 *   - SSE-based live reload: browser auto-refreshes after rebuild
 *   - Template cache busting: theme/layout changes take effect immediately
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { join } from "@std/path";
import { bootstrap } from "./bootstrap.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";
import { generateSitemap } from "../sitemap/generator.ts";
import { detectHomeSlug } from "../content/index-builder.ts";

export interface DevOptions {
  port?: number;
  debug?: boolean;
}

/**
 * Serve static files from the site's static directory or theme static directories.
 */
async function serveStaticFile(root: string, pathname: string, _themeName?: string): Promise<Response> {
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

  // Fonts rarely change during dev — cache them to avoid FOUT on navigation.
  // CSS/JS/other assets use no-cache so edits show up immediately.
  const isFont = ["ttf", "otf", "woff", "woff2", "eot"].includes(ext);
  const cacheControl = isFont ? "public, max-age=3600" : "no-cache";

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": cacheControl,
    },
  });
}

// === Live Reload ===

/** Client-side script injected into HTML responses during dev mode */
const LIVE_RELOAD_SCRIPT = `<script>
(function() {
  let retries = 0;
  function connect() {
    const es = new EventSource("/__dune_reload");
    es.onmessage = function(e) {
      if (e.data === "reload") {
        console.log("[dune] Reloading...");
        location.reload();
      }
    };
    es.onerror = function() {
      es.close();
      if (retries++ < 10) {
        setTimeout(connect, 1000 + retries * 500);
      }
    };
    es.onopen = function() { retries = 0; };
  }
  connect();
})();
</script>`;

/**
 * Inject the live-reload script before </body> or </html> in HTML responses.
 */
function injectLiveReload(response: Response): Response {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // Clone the response to read its body
  return new Response(
    response.body
      ? response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            // Decode, inject, re-encode
            const text = new TextDecoder().decode(chunk);
            const injected = text.includes("</body>")
              ? text.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`)
              : text.includes("</html>")
                ? text.replace("</html>", `${LIVE_RELOAD_SCRIPT}</html>`)
                : text + LIVE_RELOAD_SCRIPT;
            controller.enqueue(new TextEncoder().encode(injected));
          },
        }))
      : null,
    {
      status: response.status,
      headers: new Headers([...response.headers.entries()].filter(([k]) => k.toLowerCase() !== "content-length")),
    },
  );
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

  // --- SSE Live Reload ---
  // Connected clients waiting for reload events
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** Notify all connected browsers to reload */
  function notifyReload() {
    const message = new TextEncoder().encode("data: reload\n\n");
    for (const controller of sseClients) {
      try {
        controller.enqueue(message);
      } catch {
        sseClients.delete(controller);
      }
    }
  }

  /** Handle SSE connection from browser */
  function handleSSE(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sseClients.add(controller);
        // Send initial heartbeat
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel() {
        // Client disconnected — cleanup handled by the Set
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // --- File Watcher ---
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
    console.log(`  ⚡ Live reload enabled`);

    // Debounced rebuild
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
              // Notify all connected browsers
              notifyReload();
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

  // --- Request handler ---
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const start = performance.now();

    let response: Response;

    try {
      // SSE live-reload endpoint
      if (url.pathname === "/__dune_reload") {
        return handleSSE();
      }
      // Admin routes (must come before content routes)
      else if (url.pathname.startsWith(adminPrefix)) {
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
      // Dynamic sitemap (generated from content index)
      else if (url.pathname === "/sitemap.xml") {
        const siteUrl = ctx.config.site.url || `http://localhost:${port}`;
        const homeSlug = ctx.config.site.home ?? detectHomeSlug(engine.pages);
        const sitemapXml = generateSitemap(engine.pages, {
          siteUrl,
          supportedLanguages: ctx.config.system.languages?.supported,
          defaultLanguage: ctx.config.system.languages?.default,
          includeDefaultInUrl: ctx.config.system.languages?.include_default_in_url,
          homeSlug,
        });
        response = new Response(sitemapXml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }
      // Root-level static files (favicon, robots.txt)
      else if (/^\/(favicon\.(ico|svg)|robots\.txt)$/.test(url.pathname)) {
        response = await serveStaticFile(root, `/static${url.pathname}`);
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

      // Inject live-reload script into HTML responses (except admin)
      if (!url.pathname.startsWith(adminPrefix) && !url.pathname.startsWith("/api/")) {
        response = injectLiveReload(response);
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
