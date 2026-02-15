/**
 * Sitemap generator — produces XML sitemap from the content index.
 *
 * Respects routable, published, and visible fields.
 * Generates <lastmod> from page modification time.
 * For multilingual sites, adds xhtml:link hreflang alternates.
 */

import type { PageIndex } from "../content/types.ts";

export interface SitemapOptions {
  /** Base URL of the site (e.g. "https://example.com") */
  siteUrl: string;
  /** Supported language codes for hreflang (e.g. ["en", "de", "fr"]) */
  supportedLanguages?: string[];
  /** Default language for x-default hreflang */
  defaultLanguage?: string;
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
  const isMultilingual = supportedLangs.length > 1;

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
    .filter((p) => p.published && p.routable && !p.isModule)
    .map((p) => {
      const loc = escapeXml(`${base}${p.route}`);
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
          const defaultHref = defaultPage
            ? escapeXml(`${base}${defaultPage.route}`)
            : null;
          for (const [lang, altPage] of group) {
            const href = escapeXml(`${base}${altPage.route}`);
            entry += `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`;
          }
          if (defaultHref) {
            entry += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${defaultHref}"/>`;
          }
        }
      }

      if (lastmod) entry += `\n    <lastmod>${lastmod}</lastmod>`;
      entry += `\n    <priority>${priority}</priority>`;
      entry += `\n  </url>`;
      return entry;
    });

  const urlsetAttrs = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    ...(isMultilingual ? ['xmlns:xhtml="http://www.w3.org/1999/xhtml"'] : []),
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
