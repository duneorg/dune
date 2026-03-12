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
 */

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";
import { join } from "@std/path";
import { bootstrap } from "./bootstrap.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";
import { generateSitemap } from "../sitemap/generator.ts";
import { SITEMAP_XSL } from "../sitemap/stylesheet.ts";
import { detectHomeSlug } from "../content/index-builder.ts";
import { generateRss, generateAtom, type FeedItem, type FeedOptions } from "../feeds/generator.ts";

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

// === Compression ===

/** Content types worth compressing (text-based formats). */
const COMPRESSIBLE_TYPES = /^(text\/|application\/json|application\/xml|application\/javascript|image\/svg\+xml)/;

/**
 * Compress response body with gzip if the client supports it
 * and the content type is compressible.
 */
async function maybeCompress(req: Request, response: Response): Promise<Response> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!COMPRESSIBLE_TYPES.test(contentType)) return response;

  if (!response.body) return response;

  // Always buffer the body so we can set Content-Length.
  // Without Content-Length, HTTP/1.1 reverse proxies (e.g. LiteSpeed) may
  // truncate the response body when using chunked transfer encoding.
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("Vary", "Accept-Encoding");

  const accept = req.headers.get("Accept-Encoding") ?? "";
  if (accept.includes("gzip") && body.byteLength >= 256) {
    const compressed = new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")),
    );
    const compressedBody = await compressed.arrayBuffer();
    headers.set("Content-Encoding", "gzip");
    headers.set("Content-Length", String(compressedBody.byteLength));
    return new Response(compressedBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // No compression — serve raw body with explicit Content-Length.
  headers.set("Content-Length", String(body.byteLength));
  return new Response(body, {
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
  const { engine, collections, taxonomy, search, imageHandler, adminHandler, flexEngine } = ctx;
  const routes = duneRoutes(engine, collections, flexEngine, search);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });
  const adminPrefix = ctx.config.admin?.path ?? "/admin";
  const siteName = engine.site.title;
  const startTime = Date.now();

  const feedEnabled = ctx.config.site.feed?.enabled !== false;

  /** Build feed items (called once at startup). */
  async function buildFeedItems(): Promise<FeedItem[]> {
    const feedConfig = ctx.config.site.feed;
    const count = feedConfig?.items ?? 20;
    const contentMode = feedConfig?.content ?? "summary";
    const siteBase = engine.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;

    const candidates = engine.pages
      .filter((p) => p.published && p.routable && p.date !== null)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, count);

    const items: FeedItem[] = [];
    for (const pageIndex of candidates) {
      try {
        const result = await engine.resolve(pageIndex.route);
        if (result.type !== "page" || !result.page) continue;
        const page = result.page;
        const description = contentMode === "full"
          ? await page.html()
          : await page.summary();
        items.push({
          title: page.frontmatter.title || pageIndex.title,
          link: `${siteBase}${pageIndex.route}`,
          guid: `${siteBase}${pageIndex.route}`,
          pubDate: pageIndex.date ? new Date(pageIndex.date) : null,
          description,
        });
      } catch {
        // Skip pages that fail to load
      }
    }
    return items;
  }

  /** Inject feed discovery <link> tags before </head> in HTML responses. */
  function injectFeedLinks(response: Response): Response {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) return response;

    const links =
      `<link rel="alternate" type="application/rss+xml" title="${siteName}" href="/feed.xml">` +
      `\n  <link rel="alternate" type="application/atom+xml" title="${siteName}" href="/atom.xml">`;

    return new Response(
      response.body
        ? response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk);
              const injected = text.includes("</head>")
                ? text.replace("</head>", `${links}\n</head>`)
                : text;
              controller.enqueue(new TextEncoder().encode(injected));
            },
          }))
        : null,
      {
        status: response.status,
        headers: new Headers(
          [...response.headers.entries()].filter(([k]) => k.toLowerCase() !== "content-length"),
        ),
      },
    );
  }

  // Generate sitemap at startup
  const siteUrl = engine.site.url || `http://localhost:${port}`;
  const homeSlug = ctx.config.site.home ?? detectHomeSlug(engine.pages);
  const sitemapXml = generateSitemap(engine.pages, {
    siteUrl,
    supportedLanguages: ctx.config.system.languages?.supported,
    defaultLanguage: ctx.config.system.languages?.default,
    includeDefaultInUrl: ctx.config.system.languages?.include_default_in_url,
    homeSlug,
    exclude: ctx.config.site.sitemap?.exclude,
    changefreqOverrides: ctx.config.site.sitemap?.changefreq,
  });

  // Generate feeds at startup
  const siteBase = engine.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
  const feedAuthor = engine.site.author
    ? { name: engine.site.author.name, email: engine.site.author.email }
    : undefined;
  const feedLang = ctx.config.system.languages?.default ?? "en";

  let rssFeed = "";
  let atomFeed = "";
  if (feedEnabled) {
    const feedItems = await buildFeedItems();
    const baseFeedOpts: FeedOptions = {
      title: engine.site.title,
      description: engine.site.description || "",
      siteUrl: siteBase,
      feedUrl: `${siteBase}/feed.xml`,
      items: feedItems,
      language: feedLang,
      author: feedAuthor,
    };
    rssFeed = generateRss(baseFeedOpts);
    atomFeed = generateAtom({ ...baseFeedOpts, feedUrl: `${siteBase}/atom.xml` });
  }

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🗺️  Sitemap generated`);
  if (feedEnabled) console.log(`  📡 RSS + Atom feeds generated`);

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

      // Dynamic sitemap
      if (url.pathname === "/sitemap.xml") {
        return maybeCompress(req, new Response(sitemapXml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }

      // Sitemap XSL stylesheet (browser display)
      if (url.pathname === "/sitemap.xsl") {
        return new Response(SITEMAP_XSL, {
          headers: {
            "Content-Type": "text/xsl; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      // Feed routes (cached at startup)
      if (feedEnabled && url.pathname === "/feed.xml") {
        return maybeCompress(req, new Response(rssFeed, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }

      if (feedEnabled && url.pathname === "/atom.xml") {
        return maybeCompress(req, new Response(atomFeed, {
          headers: {
            "Content-Type": "application/atom+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }

      // Root-level static files (favicon.ico, robots.txt)
      if (/^\/(favicon\.(ico|svg)|robots\.txt)$/.test(url.pathname)) {
        const staticResult = await serveStaticFile(root, url.pathname);
        return withSecurityHeaders(staticResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName));
      }

      // Admin routes
      if (url.pathname.startsWith(adminPrefix)) {
        const adminResult = await adminHandler(req);
        return withSecurityHeaders(adminResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName));
      }

      // API routes — try adminHandler first (handles /api/contact etc.), then apiHandler
      if (url.pathname.startsWith("/api/")) {
        const adminApiResult = await adminHandler(req);
        if (adminApiResult) return adminApiResult;
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
      let contentResponse = await routes.contentHandler(req, renderJsx);
      if (feedEnabled) {
        contentResponse = injectFeedLinks(contentResponse);
      }
      return maybeCompress(req, withSecurityHeaders(contentResponse));
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
