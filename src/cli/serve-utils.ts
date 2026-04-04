/**
 * Shared HTTP-serving utilities used by serve.ts, dev.ts, and the multisite
 * manager.  Extracted to eliminate duplication between the two server modes.
 */

// === Security Headers ===

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

/** Apply security headers to a response, skipping any already present. */
export function withSecurityHeaders(response: Response): Response {
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

/** Content types worth gzip-compressing. */
const COMPRESSIBLE_TYPES =
  /^(text\/|application\/json|application\/xml|application\/javascript|image\/svg\+xml)/;

/**
 * Compress response body with gzip when the client supports it and the
 * content type is compressible.  Always buffers the body to set a correct
 * Content-Length (required for HTTP/1.1 reverse proxies like LiteSpeed).
 */
export async function maybeCompress(
  req: Request,
  response: Response,
): Promise<Response> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!COMPRESSIBLE_TYPES.test(contentType)) return response;
  if (!response.body) return response;

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

  headers.set("Content-Length", String(body.byteLength));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// === Static File Serving ===

export const MIME_TYPES: Record<string, string> = {
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
  // Video
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  // Other
  pdf: "application/pdf",
};

/** Long-lived assets: fonts and images (1 year, immutable). */
export const IMMUTABLE_EXTS = new Set([
  "ttf", "otf", "woff", "woff2", "eot",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "ico",
]);

/** Cache-Control header value for a given file extension. */
export function cacheControlFor(ext: string): string {
  if (IMMUTABLE_EXTS.has(ext)) return "public, max-age=31536000";
  return "public, max-age=3600, must-revalidate";
}

/** Build a Response for a static file with correct MIME type and cache headers. */
export function createFileResponse(
  file: Uint8Array,
  size: number,
  fullPath: string,
  devMode = false,
): Response {
  const ext = fullPath.split(".").pop()?.toLowerCase() ?? "";
  // In dev mode: cache fonts to avoid FOUT; no-cache everything else.
  // In production: use long-lived cache headers.
  let cacheControl: string;
  if (devMode) {
    const isFont = ["ttf", "otf", "woff", "woff2", "eot"].includes(ext);
    cacheControl = isFont ? "public, max-age=3600" : "no-cache";
  } else {
    cacheControl = cacheControlFor(ext);
  }
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Serve static files from a site's `static/` or theme `static/` directories.
 * In multisite setups, pass `sharedThemesDir` so theme assets stored outside
 * the individual site root (e.g. a top-level `themes/` directory) are found.
 * Returns `null` for paths that don't resolve to a readable file.
 */
export async function serveStaticFile(
  root: string,
  pathname: string,
  devMode = false,
  sharedThemesDir?: string,
): Promise<Response | null> {
  let filePath: string;
  let fullPath: string;
  let sharedPath: string | undefined;

  if (pathname.startsWith("/themes/") && pathname.includes("/static/")) {
    const themeMatch = pathname.match(/^\/themes\/([^/]+)\/static\/(.+)$/);
    if (!themeMatch) return null;
    const [, theme, path] = themeMatch;
    filePath = path;
    fullPath = `${root}/themes/${theme}/static/${path}`;
    if (sharedThemesDir) {
      sharedPath = `${sharedThemesDir}/${theme}/static/${path}`;
    }
  } else if (/^\/(favicon\.(ico|svg)|robots\.txt|sitemap\.xml)$/.test(pathname)) {
    filePath = pathname.slice(1);
    fullPath = `${root}/static/${filePath}`;
  } else {
    filePath = pathname.replace(/^\/static\//, "");
    fullPath = `${root}/static/${filePath}`;
  }

  // Security: prevent directory traversal
  if (filePath.includes("..") || filePath.startsWith("/")) return null;

  // Try site-local path first, then shared themes dir.
  for (const candidate of [fullPath, sharedPath]) {
    if (!candidate) continue;
    try {
      const file = await Deno.readFile(candidate);
      const stat = await Deno.stat(candidate);
      return createFileResponse(file, stat.size, candidate, devMode);
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Serve a static file from a plugin's assets directory.
 * URL format: `/plugins/{pluginName}/{...path}`
 */
export async function servePluginAsset(
  pluginAssetDirs: Map<string, string>,
  pathname: string,
  devMode = false,
): Promise<Response | null> {
  const match = pathname.match(/^\/plugins\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, pluginName, filePath] = match;
  const assetDir = pluginAssetDirs.get(pluginName);
  if (!assetDir) return null;
  if (filePath.includes("..") || filePath.startsWith("/")) return null;
  const fullPath = `${assetDir}/${filePath}`;
  try {
    const file = await Deno.readFile(fullPath);
    const stat = await Deno.stat(fullPath);
    return createFileResponse(file, stat.size, fullPath, devMode);
  } catch {
    return null;
  }
}

// === Error Pages ===

/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact-render-to-string";

/** Render a minimal themed error page (no theme dependency). */
export function renderErrorPage(
  status: number,
  title: string,
  message: string,
  siteName: string,
): Response {
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

// === Feed Link Injection ===

/** Inject RSS/Atom feed discovery `<link>` tags before `</head>`. */
export function injectFeedLinks(siteName: string, response: Response): Response {
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

// === Live Reload (dev mode only) ===

/** Client-side SSE script injected into HTML responses during dev mode. */
export const LIVE_RELOAD_SCRIPT = `<script>
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

// === RTL Direction Injection ===

/**
 * Inject `dir="rtl"` onto the `<html>` tag of an HTML response when the page
 * language uses a right-to-left script.
 *
 * Only modifies the response when:
 * 1. The Content-Type is text/html
 * 2. `rtl` is true
 * 3. The existing `<html` tag does not already carry a `dir=` attribute
 *
 * This is a safety-net for theme templates that don't yet consume the `dir`
 * prop from TemplateProps.  Themes that do set `dir` explicitly are unaffected.
 */
export function injectRtlDir(response: Response, rtl: boolean): Response {
  if (!rtl) return response;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  return new Response(
    response.body
      ? response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const text = new TextDecoder().decode(chunk);
            // Only inject when there is no existing dir= on the <html> tag.
            const injected = /(<html\b[^>]*)\bdir=/.test(text)
              ? text
              : text.replace(/(<html\b)([^>]*>)/, '$1 dir="rtl"$2');
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

/** Inject the live-reload script before `</body>` or `</html>`. */
export function injectLiveReload(response: Response): Response {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  return new Response(
    response.body
      ? response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
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
      headers: new Headers(
        [...response.headers.entries()].filter(([k]) => k.toLowerCase() !== "content-length"),
      ),
    },
  );
}
