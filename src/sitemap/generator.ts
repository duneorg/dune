/**
 * Sitemap generator — produces XML sitemap from the content index.
 *
 * Respects routable, published, and visible fields.
 * Generates <lastmod> from page modification time.
 */

import type { PageIndex } from "../content/types.ts";

/**
 * Generate a sitemap.xml string from the content index.
 *
 * @param pages All page indexes
 * @param siteUrl Base URL of the site (e.g. "https://example.com")
 */
export function generateSitemap(pages: PageIndex[], siteUrl: string): string {
  // Normalize: strip trailing slash from site URL
  const base = siteUrl.replace(/\/$/, "");

  const urls = pages
    .filter((p) => p.published && p.routable && !p.isModule)
    .map((p) => {
      const loc = escapeXml(`${base}${p.route}`);
      const lastmod = p.mtime
        ? new Date(p.mtime).toISOString().split("T")[0]
        : undefined;
      // Home page gets highest priority, depth 0 = 1.0, depth 1 = 0.8, etc.
      const priority = Math.max(0.1, 1.0 - p.depth * 0.2).toFixed(1);

      let entry = `  <url>\n    <loc>${loc}</loc>`;
      if (lastmod) entry += `\n    <lastmod>${lastmod}</lastmod>`;
      entry += `\n    <priority>${priority}</priority>`;
      entry += `\n  </url>`;
      return entry;
    });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
