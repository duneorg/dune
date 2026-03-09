/**
 * Sitemap generator — produces XML sitemap from the content index.
 *
 * Respects routable, published, and visible fields.
 * Excludes pages whose ancestor (parent section) is unpublished.
 * Generates <lastmod> from page modification time.
 * For multilingual sites, adds xhtml:link hreflang alternates.
 */

import { dirname } from "@std/path";
import type { PageIndex } from "../content/types.ts";

export interface SitemapOptions {
  /** Base URL of the site (e.g. "https://example.com") */
  siteUrl: string;
  /** Supported language codes for hreflang (e.g. ["en", "de", "fr"]) */
  supportedLanguages?: string[];
  /** Default language for x-default hreflang */
  defaultLanguage?: string;
  /** If true, default language also gets /en/ prefix in URLs */
  includeDefaultInUrl?: boolean;
  /** Home page slug (e.g. "efficiency") — route "/efficiency" maps to "/" for default lang */
  homeSlug?: string;
  /** Route prefixes or exact paths to exclude from the sitemap. Prefix-match. */
  exclude?: string[];
  /**
   * Per-route changefreq overrides. Longest matching prefix key wins.
   * Overrides the depth-based heuristic (depth 0→daily, 1→weekly, 2+→monthly).
   * @example { "/": "hourly", "/blog": "daily" }
   */
  changefreqOverrides?: Record<string, "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never">;
}

/**
 * Generate a sitemap.xml string from the content index.
 *
 * @param pages All page indexes
 * @param siteUrlOrOptions Base URL string or options object
 */
export function generateSitemap(
  pages: PageIndex[],
  siteUrlOrOptions: string | SitemapOptions,
): string {
  const options: SitemapOptions =
    typeof siteUrlOrOptions === "string"
      ? { siteUrl: siteUrlOrOptions }
      : siteUrlOrOptions;

  const base = options.siteUrl.replace(/\/$/, "");
  const supportedLangs = options.supportedLanguages ?? [];
  const defaultLang = options.defaultLanguage ?? "en";
  const includeDefaultInUrl = options.includeDefaultInUrl ?? false;
  const homeRoute = "/" + (options.homeSlug ?? "");
  const isMultilingual = supportedLangs.length > 1;

  /** Build full URL for a page (with language prefix when multilingual) */
  const pageToUrl = (p: PageIndex): string => {
    if (!isMultilingual) return base + p.route;
    const needsPrefix = p.language !== defaultLang || includeDefaultInUrl;
    if (!needsPrefix) {
      return base + (p.route === homeRoute ? "/" : p.route);
    }
    const path = p.route === homeRoute ? "" : p.route;
    return base + "/" + p.language + path;
  };

  /** Check if page has any unpublished ancestor (exclude from sitemap if so) */
  const hasUnpublishedAncestor = (p: PageIndex): boolean => {
    let current: PageIndex | null = p;
    while (current?.parentPath) {
      const parent = pages.find(
        (q) => dirname(q.sourcePath) === current!.parentPath && q.language === current!.language,
      );
      if (!parent) break;
      if (!parent.published) return true;
      current = parent;
    }
    return false;
  };

  // Build translation groups: sourcePath base → Map<language, page>
  const groups = new Map<string, Map<string, PageIndex>>();
  for (const p of pages) {
    if (!p.published || !p.routable || p.isModule) continue;
    const key = getTranslationGroupKey(p.sourcePath, supportedLangs);
    let group = groups.get(key);
    if (!group) {
      group = new Map();
      groups.set(key, group);
    }
    group.set(p.language, p);
  }

  const urlEntries = pages
    .filter((p) =>
      p.published && p.routable && !p.isModule && !hasUnpublishedAncestor(p) &&
      !isExcluded(p.route, options.exclude ?? []),
    )
    .map((p) => {
      const loc = escapeXml(pageToUrl(p));
      const lastmod = p.mtime
        ? new Date(p.mtime).toISOString().split("T")[0]
        : undefined;
      const priority = Math.max(0.1, 1.0 - p.depth * 0.2).toFixed(1);

      let entry = `  <url>\n    <loc>${loc}</loc>`;

      // Add hreflang alternates for multilingual pages
      if (isMultilingual) {
        const key = getTranslationGroupKey(p.sourcePath, supportedLangs);
        const group = groups.get(key);
        if (group && group.size > 0) {
          const defaultPage = group.get(defaultLang);
          const defaultHref = defaultPage ? escapeXml(pageToUrl(defaultPage)) : null;
          for (const [, altPage] of group) {
            const href = escapeXml(pageToUrl(altPage));
            entry += `\n    <xhtml:link rel="alternate" hreflang="${altPage.language}" href="${href}"/>`;
          }
          if (defaultHref) {
            entry += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${defaultHref}"/>`;
          }
        }
      }

      // changefreq: override map wins, then depth-based heuristic
      const changefreq = resolveChangefreq(p.route, options.changefreqOverrides ?? {}, p.depth);

      // Add cover image entry when present
      if (p.coverImage) {
        entry += `\n    <image:image>\n      <image:loc>${escapeXml(base + p.coverImage)}</image:loc>\n    </image:image>`;
      }

      if (lastmod) entry += `\n    <lastmod>${lastmod}</lastmod>`;
      entry += `\n    <changefreq>${changefreq}</changefreq>`;
      entry += `\n    <priority>${priority}</priority>`;
      entry += `\n  </url>`;
      return entry;
    });

  const hasImages = pages.some((p) => p.published && p.routable && !p.isModule && p.coverImage &&
    !isExcluded(p.route, options.exclude ?? []));
  const urlsetAttrs = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    ...(isMultilingual ? ['xmlns:xhtml="http://www.w3.org/1999/xhtml"'] : []),
    ...(hasImages ? ['xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'] : []),
  ].join(" ");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset ${urlsetAttrs}>`,
    ...urlEntries,
    `</urlset>`,
  ].join("\n");
}

/** Derive translation group key from sourcePath (e.g. "01.webapps/default") */
function getTranslationGroupKey(
  sourcePath: string,
  supportedLangs: string[],
): string {
  // Strip extension: "01.webapps/default.de.md" → "01.webapps/default.de"
  let base = sourcePath.replace(/\.(md|mdx|tsx)$/, "");
  // Strip language suffix when it's a known supported language
  if (supportedLangs.length > 0) {
    const langSuffix = supportedLangs
      .map((l) => l.toLowerCase())
      .find((l) => base.endsWith("." + l));
    if (langSuffix) base = base.slice(0, -langSuffix.length - 1);
  }
  return base;
}

/** Check if a route should be excluded based on prefix patterns. */
function isExcluded(route: string, patterns: string[]): boolean {
  return patterns.some((p) => route === p || route.startsWith(p === "/" ? p : p + "/"));
}

type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

/**
 * Resolve changefreq for a route.
 * Checks overrides (longest matching prefix wins), falls back to depth heuristic.
 */
function resolveChangefreq(
  route: string,
  overrides: Record<string, ChangeFreq>,
  depth: number,
): ChangeFreq {
  // Find the longest matching prefix key
  let bestKey = "";
  let bestFreq: ChangeFreq | null = null;
  for (const [key, freq] of Object.entries(overrides)) {
    const matches = route === key || route.startsWith(key === "/" ? key : key + "/");
    if (matches && key.length > bestKey.length) {
      bestKey = key;
      bestFreq = freq;
    }
  }
  if (bestFreq) return bestFreq;
  // Depth-based default
  return depth === 0 ? "daily" : depth === 1 ? "weekly" : "monthly";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
