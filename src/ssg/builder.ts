/**
 * Static Site Generator — renders every routable page to HTML on disk.
 *
 * Strategy
 * ────────
 * The production request handler (`createProductionSiteHandler`) is already a
 * pure `(Request) → Response` function.  For each route we synthesise a fake
 * GET request, call the handler, and write the response body to the output
 * directory.  Special files (sitemap, feeds) are generated directly via their
 * respective generators to avoid dealing with the gzip-encoded handler output.
 *
 * Image processing (`?w=…&q=…` params) is intentionally NOT run during a
 * static build.  Source media files are copied verbatim; static hosts
 * silently discard the query string when serving the raw file.
 */

import { join, dirname } from "@std/path";
import { parseFolderName } from "../content/path-utils.ts";
import { ensureDir } from "@std/fs";
import type { BootstrapResult } from "../cli/bootstrap.ts";
import type { SitePrebuilt } from "../cli/site-handler.ts";
import { createProductionSiteHandler } from "../cli/site-handler.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { DuneConfig } from "../config/types.ts";
import type { FlexEngine } from "../flex/engine.ts";
import { generateSitemap } from "../sitemap/generator.ts";
import { generateRss, generateAtom, type FeedItem, type FeedOptions } from "../feeds/generator.ts";
import { detectHomeSlug } from "../content/index-builder.ts";
import type { SSGOptions, SSGResult } from "./types.ts";
import {
  newManifest,
  loadManifest,
  saveManifest,
  hashFile,
  type BuildManifest,
} from "./manifest.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

/** File extensions that identify content/config files (skip when copying media). */
const CONTENT_EXTENSIONS = new Set([
  "md", "mdx", "tsx", "yaml", "yml",
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a full (or incremental) static build.
 *
 * @param root   Absolute path to the site root directory.
 * @param ctx    Fully-bootstrapped BootstrapResult from bootstrap().
 * @param opts   Build options.
 */
export async function buildStatic(
  root: string,
  ctx: BootstrapResult,
  opts: SSGOptions,
): Promise<SSGResult> {
  const t0 = performance.now();
  const { engine, config, flexEngine, pluginAssetDirs, sharedThemesDir } = ctx;

  const outDir = join(root, opts.outDir);
  const baseUrl = (opts.baseUrl ?? config.site.url ?? "http://localhost:8000")
    .replace(/\/$/, "");

  // Load existing manifest (incremental) or start fresh.
  const manifest: BuildManifest = opts.incremental
    ? (await loadManifest(outDir)) ?? newManifest(baseUrl)
    : newManifest(baseUrl);

  // Ensure output directory exists.
  await ensureDir(outDir);

  // Build a minimal SitePrebuilt that satisfies the handler's type signature.
  // We set feedEnabled=false so the handler never tries to serve feeds from
  // the prebuilt (we generate those files directly below).
  const minimalPrebuilt: SitePrebuilt = {
    sitemapGzip: new ArrayBuffer(0),
    rssFeed: "",
    atomFeed: "",
    feedEnabled: false,
    startTime: Date.now(),
  };

  // Create the production handler — same code path as `dune serve`.
  const handler = createProductionSiteHandler(ctx, minimalPrebuilt, root, {
    port: 8000,
    debug: false,
  });

  // ── Enumerate routes ──────────────────────────────────────────────────────

  const contentPageRoutes = collectContentRoutes(engine, opts.includeDrafts);
  const flexRoutes = await collectFlexRoutes(flexEngine);
  const alwaysRender = ["/search"];

  // Include /search only if there is a search engine and at least one page.
  const allRoutes: string[] = [
    ...contentPageRoutes,
    ...flexRoutes,
    ...alwaysRender,
  ];

  // ── Render content routes ─────────────────────────────────────────────────

  let pagesRendered = 0;
  let pagesSkipped = 0;
  const errors: Array<{ route: string; error: string }> = [];

  const contentDir = config.system.content.dir;

  for (let i = 0; i < allRoutes.length; i += opts.concurrency) {
    const batch = allRoutes.slice(i, i + opts.concurrency);
    await Promise.all(batch.map(async (route) => {
      try {
        // Incremental: hash the source file and skip if unchanged.
        if (opts.incremental) {
          const pageIndex = engine.pages.find((p) => p.route === route);
          if (pageIndex) {
            const sourceFile = join(root, contentDir, pageIndex.sourcePath);
            const hash = await hashFile(sourceFile);
            const cached = manifest.entries[route];
            if (cached && cached.contentHash === hash && hash !== "") {
              pagesSkipped++;
              return;
            }
            const outputPath = routeToOutputPath(route);
            manifest.entries[route] = {
              route,
              outputPath,
              contentHash: hash,
              builtAt: Date.now(),
            };
          }
        }

        // Render via handler.
        const url = `${baseUrl}${route}`;
        const res = await handler(new Request(url));

        // Redirects: write a meta-refresh HTML stub so static hosts don't
        // need server-side redirect support.
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("Location") ?? "/";
          await writeRedirectStub(outDir, route, location);
          pagesRendered++;
          if (opts.verbose) console.log(`  ↪ ${route} → ${location}`);
          return;
        }

        // Non-2xx pages still get written (e.g. a custom 404 page at /404).
        const outputPath = routeToOutputPath(route);
        await writeResponseToFile(outDir, outputPath, res);
        pagesRendered++;
        if (opts.verbose) console.log(`  ✓ ${route}`);
      } catch (err) {
        errors.push({ route, error: String(err) });
        if (opts.verbose) console.log(`  ✗ ${route}: ${err}`);
      }
    }));
  }

  // ── Special files ─────────────────────────────────────────────────────────

  await writeSpecialFiles(outDir, engine, config, baseUrl, opts.verbose);

  // Fallback 404.html — write a minimal one if no content page provides it.
  const custom404 = engine.pages.some((p) => p.route === "/404");
  if (!custom404) {
    const fallback404Path = join(outDir, "404.html");
    try { await Deno.stat(fallback404Path); } catch {
      await writeDefault404(fallback404Path, engine.site.title);
    }
  }

  // ── Static assets ─────────────────────────────────────────────────────────

  let assetsWritten = 0;
  assetsWritten += await copyStaticAssets(root, outDir, config, pluginAssetDirs, sharedThemesDir);
  assetsWritten += await copyContentMedia(join(root, contentDir), outDir);

  // ── Hybrid config ─────────────────────────────────────────────────────────

  if (opts.hybrid) {
    await writeHybridConfig(outDir, config);
  }

  // ── Save manifest ─────────────────────────────────────────────────────────

  manifest.builtAt = Date.now();
  manifest.baseUrl = baseUrl;
  await saveManifest(outDir, manifest);

  return {
    pagesRendered,
    pagesSkipped,
    assetsWritten,
    errors,
    elapsed: Math.round(performance.now() - t0),
  };
}

// ─── Route enumeration ───────────────────────────────────────────────────────

function collectContentRoutes(engine: DuneEngine, includeDrafts: boolean): string[] {
  return engine.pages
    .filter((p) => p.routable && (includeDrafts || p.published))
    .map((p) => p.route);
}

async function collectFlexRoutes(flexEngine: FlexEngine): Promise<string[]> {
  const routes: string[] = [];
  try {
    const schemas = await flexEngine.loadSchemas();
    for (const [type] of Object.entries(schemas)) {
      routes.push(`/flex/${encodeURIComponent(type)}`);
      const records = await flexEngine.list(type);
      for (const record of records) {
        routes.push(`/flex/${encodeURIComponent(type)}/${encodeURIComponent(record._id)}`);
      }
    }
  } catch { /* flex-objects directory absent — skip */ }
  return routes;
}

// ─── Output path helpers ──────────────────────────────────────────────────────

/**
 * Derive the output file path within the dist directory for a given route.
 *
 * - `/`               → `index.html`
 * - `/about`          → `about/index.html`
 * - `/blog/post`      → `blog/post/index.html`
 * - `/sitemap.xml`    → `sitemap.xml`
 * - `/404`            → `404.html`  (special-cased for static hosts)
 */
export function routeToOutputPath(route: string): string {
  if (route === "/" || route === "") return "index.html";
  if (route === "/404") return "404.html";
  const stripped = route.startsWith("/") ? route.slice(1) : route;
  // Has a file extension → write as-is.
  if (/\.[a-z0-9]+$/i.test(stripped)) return stripped;
  // Directory route → index.html inside that directory.
  return `${stripped}/index.html`;
}

// ─── Writing helpers ──────────────────────────────────────────────────────────

async function writeResponseToFile(
  outDir: string,
  outputPath: string,
  res: Response,
): Promise<void> {
  const fullPath = join(outDir, outputPath);
  await ensureDir(dirname(fullPath));
  const body = await res.arrayBuffer();
  await Deno.writeFile(fullPath, new Uint8Array(body));
}

async function writeRedirectStub(
  outDir: string,
  route: string,
  location: string,
): Promise<void> {
  const outputPath = routeToOutputPath(route);
  const fullPath = join(outDir, outputPath);
  await ensureDir(dirname(fullPath));
  await Deno.writeTextFile(fullPath, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${location}">
  <link rel="canonical" href="${location}">
</head>
<body><p>Redirecting to <a href="${location}">${location}</a>…</p></body>
</html>`);
}

async function writeDefault404(path: string, siteName: string): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — Not Found | ${siteName}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px;
           margin: 4rem auto; padding: 0 1.5rem; color: #333; text-align: center; }
    h1 { font-size: 4rem; margin: 0; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>404</h1>
  <p>The page you were looking for doesn't exist.</p>
  <p><a href="/">← Back to ${siteName}</a></p>
</body>
</html>`);
}

// ─── Special files ────────────────────────────────────────────────────────────

async function writeSpecialFiles(
  outDir: string,
  engine: DuneEngine,
  config: DuneConfig,
  baseUrl: string,
  verbose: boolean,
): Promise<void> {
  // Sitemap
  const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
  const sitemapXml = generateSitemap(engine.pages, {
    siteUrl: baseUrl,
    supportedLanguages: config.system.languages?.supported,
    defaultLanguage: config.system.languages?.default,
    includeDefaultInUrl: config.system.languages?.include_default_in_url,
    homeSlug,
    exclude: config.site.sitemap?.exclude,
    changefreqOverrides: config.site.sitemap?.changefreq,
  });
  await Deno.writeTextFile(join(outDir, "sitemap.xml"), sitemapXml);
  if (verbose) console.log("  ✓ sitemap.xml");

  // Feeds
  const feedEnabled = config.site.feed?.enabled !== false;
  if (feedEnabled) {
    const siteBase = baseUrl;
    const feedCount = config.site.feed?.items ?? 20;
    const contentMode = config.site.feed?.content ?? "summary";
    const feedLang = config.system.languages?.default ?? "en";
    const feedAuthor = engine.site.author
      ? { name: engine.site.author.name, email: engine.site.author.email }
      : undefined;

    const candidates = engine.pages
      .filter((p) => p.published && p.routable && p.date !== null)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, feedCount);

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
      } catch { /* skip pages that fail to load */ }
    }

    const feedOpts: FeedOptions = {
      title: engine.site.title,
      description: engine.site.description || "",
      siteUrl: siteBase,
      feedUrl: `${siteBase}/feed.xml`,
      items,
      language: feedLang,
      author: feedAuthor,
    };

    await Deno.writeTextFile(join(outDir, "feed.xml"), generateRss(feedOpts));
    await Deno.writeTextFile(
      join(outDir, "atom.xml"),
      generateAtom({ ...feedOpts, feedUrl: `${siteBase}/atom.xml` }),
    );
    if (verbose) console.log("  ✓ feed.xml, atom.xml");
  }

  // robots.txt — use site-level static/robots.txt if present, else emit a default.
  const robotsDest = join(outDir, "robots.txt");
  try {
    await Deno.stat(robotsDest); // already written by asset copy
  } catch {
    // Check the site's static/ directory directly.
    try {
      await Deno.stat(join(dirname(outDir), "static", "robots.txt"));
    } catch {
      await Deno.writeTextFile(
        robotsDest,
        `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
      );
      if (verbose) console.log("  ✓ robots.txt (default)");
    }
  }
}

// ─── Asset copying ────────────────────────────────────────────────────────────

async function copyStaticAssets(
  root: string,
  outDir: string,
  config: DuneConfig,
  pluginAssetDirs: Map<string, string>,
  sharedThemesDir?: string,
): Promise<number> {
  let count = 0;
  const theme = config.theme.name;

  // Site-level static/
  count += await copyDir(join(root, "static"), join(outDir, "static"));

  // Active theme static/ (site-local first, then shared themes dir)
  const themeStaticOut = join(outDir, "themes", theme, "static");
  count += await copyDir(join(root, "themes", theme, "static"), themeStaticOut);
  if (sharedThemesDir) {
    count += await copyDir(join(sharedThemesDir, theme, "static"), themeStaticOut);
  }

  // Plugin assets
  for (const [name, assetDir] of pluginAssetDirs) {
    count += await copyDir(assetDir, join(outDir, "plugins", name));
  }

  return count;
}

/**
 * Copy co-located media files to their route-based output paths.
 * e.g. content/04.blog/01.post/image.jpg → outDir/blog/post/image.jpg
 */
async function copyContentMedia(contentRoot: string, outDir: string): Promise<number> {
  return copyMediaWithRoutes(contentRoot, contentRoot, outDir);
}

async function copyMediaWithRoutes(src: string, contentRoot: string, outDir: string): Promise<number> {
  let count = 0;
  try {
    const stat = await Deno.stat(src);
    if (!stat.isDirectory) return 0;
  } catch {
    return 0;
  }

  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    if (entry.isDirectory) {
      count += await copyMediaWithRoutes(srcPath, contentRoot, outDir);
    } else if (entry.isFile) {
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!CONTENT_EXTENSIONS.has(ext) && !entry.name.endsWith(".meta.yaml") && !entry.name.endsWith(".frontmatter.yaml")) {
        // Compute the route prefix for this file's containing directory
        const relDir = src.length > contentRoot.length ? src.slice(contentRoot.length + 1) : "";
        const routePrefix = relDir
          ? relDir.split("/").filter(Boolean).map((seg) => parseFolderName(seg).slug).join("/")
          : "";
        const destRelPath = routePrefix ? `${routePrefix}/${entry.name}` : entry.name;
        const destPath = join(outDir, destRelPath);
        await ensureDir(dirname(destPath));
        await Deno.copyFile(srcPath, destPath);
        count++;
      }
    }
  }
  return count;
}

/**
 * Recursively copy `src/` to `dest/`, optionally filtered by file name.
 * Silently skips when `src` does not exist.
 * Returns the number of files written.
 */
async function copyDir(
  src: string,
  dest: string,
  filter?: (name: string) => boolean,
): Promise<number> {
  let count = 0;
  try {
    const stat = await Deno.stat(src);
    if (!stat.isDirectory) return 0;
  } catch {
    return 0; // source absent — skip
  }

  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory) {
      count += await copyDir(srcPath, destPath, filter);
    } else if (entry.isFile) {
      if (filter && !filter(entry.name)) continue;
      await ensureDir(dest);
      await Deno.copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

// ─── Hybrid mode config ───────────────────────────────────────────────────────

/**
 * Write Cloudflare Pages _routes.json and a _headers file so API / admin
 * routes are forwarded to a Worker while everything else is served from the
 * static assets.
 */
async function writeHybridConfig(outDir: string, config: DuneConfig): Promise<void> {
  const adminPath = config.admin?.path ?? "/admin";

  // Cloudflare Pages _routes.json
  const routesJson = {
    version: 1,
    description: "Dune hybrid mode — static pages + dynamic API/admin",
    include: [`${adminPath}/*`, "/api/*"],
    exclude: ["/static/*", "/themes/*", "/content-media/*"],
  };
  await Deno.writeTextFile(
    join(outDir, "_routes.json"),
    JSON.stringify(routesJson, null, 2),
  );

  // Netlify _redirects for API/admin proxy
  const netlifyRedirects = [
    `${adminPath}/*  /.netlify/functions/dune  200`,
    `/api/*  /.netlify/functions/dune  200`,
  ].join("\n") + "\n";
  await Deno.writeTextFile(join(outDir, "_redirects"), netlifyRedirects);

  // _headers for security headers on all static files
  const headers = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
`;
  await Deno.writeTextFile(join(outDir, "_headers"), headers);
}
