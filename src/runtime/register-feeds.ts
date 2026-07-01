import type { App } from "fresh";
import type { BootstrapResult } from "./bootstrap.ts";
import { generateSitemap } from "../sitemap/generator.ts";
import { SITEMAP_XSL } from "../sitemap/stylesheet.ts";
import { detectHomeSlug } from "../content/index-builder.ts";
import {
  generateRss,
  generateAtom,
  type FeedItem,
  type FeedOptions,
} from "../feeds/generator.ts";
import {
  maybeCompress,
  withSecurityHeaders,
  renderErrorPage,
} from "../cli/serve-utils.ts";
import { serveStagedPreview } from "../staging/preview.ts";

export interface FeedRouteOptions {
  port: number;
  dev: boolean;
}

/**
 * Pre-build and register sitemap, RSS/Atom feeds, staged preview, and dev SSE live-reload.
 * In production, feeds are pre-compressed at startup. In dev, generated on demand.
 */
export async function registerFeeds(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
  opts: FeedRouteOptions,
): Promise<{ notifyReload: () => void }> {
  const { port, dev } = opts;
  const { engine, config } = ctx;
  const feedEnabled = config.site.feed?.enabled !== false;
  const siteName = engine.site.title;
  // deno-lint-ignore no-explicit-any
  const getStaging = () => (ctx.adminContext as any)?.staging;

  async function buildFeedItems(): Promise<FeedItem[]> {
    const feedConfig = config.site.feed;
    const count = feedConfig?.items ?? 20;
    const contentMode = feedConfig?.content ?? "summary";
    const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
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
        const description = contentMode === "full" ? await page.html() : await page.summary();
        items.push({
          title: page.frontmatter.title || pageIndex.title,
          link: `${siteBase}${pageIndex.route}`,
          guid: `${siteBase}${pageIndex.route}`,
          pubDate: pageIndex.date ? new Date(pageIndex.date) : null,
          description,
        });
      } catch { /* skip */ }
    }
    return items;
  }

  // ── Production pre-builds ────────────────────────────────────────────────────
  let sitemapGzip: ArrayBuffer | null = null;
  let rssFeed = "";
  let atomFeed = "";

  if (!dev) {
    const siteUrl = engine.site.url || `http://localhost:${port}`;
    const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
    const sitemapXml = generateSitemap(engine.pages, {
      siteUrl,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      includeDefaultInUrl: config.system.languages?.include_default_in_url,
      homeSlug,
      exclude: config.site.sitemap?.exclude,
      changefreqOverrides: config.site.sitemap?.changefreq,
    });
    const sitemapBytes = new TextEncoder().encode(sitemapXml);
    sitemapGzip = await new Response(
      new Blob([sitemapBytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();

    if (feedEnabled) {
      const siteBase = engine.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const feedAuthor = engine.site.author
        ? { name: engine.site.author.name, email: engine.site.author.email }
        : undefined;
      const items = await buildFeedItems();
      const baseFeedOpts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/feed.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: feedAuthor,
      };
      rssFeed = generateRss(baseFeedOpts);
      atomFeed = generateAtom({ ...baseFeedOpts, feedUrl: `${siteBase}/atom.xml` });
    }
  }

  // ── Dev SSE live-reload ──────────────────────────────────────────────────────
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function notifyReload(): void {
    if (!dev) return;
    const message = new TextEncoder().encode("data: reload\n\n");
    for (const ctrl of sseClients) {
      try {
        ctrl.enqueue(message);
      } catch {
        sseClients.delete(ctrl);
      }
    }
  }

  // ── Route registration ───────────────────────────────────────────────────────

  app.get("/sitemap.xml", async (_fc) => {
    if (!dev && sitemapGzip) {
      return new Response(sitemapGzip, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Encoding": "gzip",
          "Content-Length": String(sitemapGzip.byteLength),
          "Cache-Control": "public, max-age=3600, must-revalidate",
          "Vary": "Accept-Encoding",
        },
      });
    }
    const siteUrl = config.site.url || `http://localhost:${port}`;
    const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
    const xml = generateSitemap(engine.pages, {
      siteUrl,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      includeDefaultInUrl: config.system.languages?.include_default_in_url,
      homeSlug,
      exclude: config.site.sitemap?.exclude,
      changefreqOverrides: config.site.sitemap?.changefreq,
    });
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" },
    });
  });

  app.get("/sitemap.xsl", () =>
    new Response(SITEMAP_XSL, {
      headers: {
        "Content-Type": "text/xsl; charset=utf-8",
        "Cache-Control": dev ? "no-cache" : "public, max-age=86400",
      },
    })
  );

  if (feedEnabled) {
    app.get("/feed.xml", async (fc) => {
      if (!dev && rssFeed) {
        return await maybeCompress(fc.req, new Response(rssFeed, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }
      const items = await buildFeedItems();
      const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const opts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/feed.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: engine.site.author
          ? { name: engine.site.author.name, email: engine.site.author.email }
          : undefined,
      };
      return new Response(generateRss(opts), {
        headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-cache" },
      });
    });

    app.get("/atom.xml", async (fc) => {
      if (!dev && atomFeed) {
        return await maybeCompress(fc.req, new Response(atomFeed, {
          headers: {
            "Content-Type": "application/atom+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }
      const items = await buildFeedItems();
      const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const opts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/atom.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: engine.site.author
          ? { name: engine.site.author.name, email: engine.site.author.email }
          : undefined,
      };
      return new Response(generateAtom(opts), {
        headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "no-cache" },
      });
    });
  }

  app.get("/__preview", async (fc) => {
    const result = await serveStagedPreview(fc.url, engine, getStaging());
    return result ?? withSecurityHeaders(
      renderErrorPage(404, "Not Found", "Preview not found or token invalid.", siteName),
    );
  });

  if (dev) {
    app.get("/__dune_reload", () => {
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          sseClients.add(ctrl);
          ctrl.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
        cancel() { /* client disconnected */ },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    });
  }

  return { notifyReload };
}
