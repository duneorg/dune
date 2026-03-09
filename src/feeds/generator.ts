/**
 * Feed generator — produces RSS 2.0 and Atom 1.0 feeds from page content.
 *
 * Both generators are pure functions that accept pre-loaded FeedItem arrays
 * and return an XML string. Callers are responsible for loading page content.
 */

export interface FeedItem {
  /** Page title */
  title: string;
  /** Absolute URL to the page */
  link: string;
  /** Unique identifier — same as link */
  guid: string;
  /** Publication date */
  pubDate: Date | null;
  /**
   * Item body — HTML for "full" mode, plain-text excerpt for "summary" mode.
   * Wrapped in CDATA in the XML output.
   */
  description: string;
}

export interface FeedOptions {
  /** Feed title (usually the site name) */
  title: string;
  /** Feed description */
  description: string;
  /** Site base URL (e.g. "https://example.com") */
  siteUrl: string;
  /** Absolute URL to this feed (self-link) */
  feedUrl: string;
  /** Feed items, newest-first */
  items: FeedItem[];
  /** BCP-47 language code (e.g. "en", "de") */
  language?: string;
  /** Feed author / site owner */
  author?: { name: string; email?: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a Date as RFC-822 (used by RSS 2.0 pubDate).
 * Example: "Mon, 02 Jan 2006 15:04:05 +0000"
 */
function toRfc822(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

/**
 * Format a Date as ISO-8601 (used by Atom updated/published).
 * Example: "2006-01-02T15:04:05Z"
 */
function toIso8601(date: Date): string {
  return date.toISOString();
}

// ── RSS 2.0 ────────────────────────────────────────────────────────────────

/**
 * Generate an RSS 2.0 feed XML string.
 *
 * Spec: https://www.rssboard.org/rss-specification
 * Includes an Atom self-link for feed-reader compatibility.
 */
export function generateRss(options: FeedOptions): string {
  const { title, description, siteUrl, feedUrl, items, language, author } = options;
  const base = siteUrl.replace(/\/$/, "");

  const channelMeta = [
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(base)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    language ? `    <language>${escapeXml(language)}</language>` : null,
    author?.name ? `    <managingEditor>${escapeXml(author.email ? `${author.email} (${author.name})` : author.name)}</managingEditor>` : null,
    `    <generator>Dune CMS</generator>`,
  ].filter(Boolean).join("\n");

  const itemEntries = items.map((item) => {
    const lines = [
      `    <item>`,
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${escapeXml(item.link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>`,
      item.pubDate ? `      <pubDate>${toRfc822(item.pubDate)}</pubDate>` : null,
      `      <description><![CDATA[${item.description}]]></description>`,
      `    </item>`,
    ].filter(Boolean);
    return lines.join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    channelMeta,
    ...itemEntries,
    `  </channel>`,
    `</rss>`,
  ].join("\n");
}

// ── Atom 1.0 ───────────────────────────────────────────────────────────────

/**
 * Generate an Atom 1.0 feed XML string.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc4287
 */
export function generateAtom(options: FeedOptions): string {
  const { title, description, siteUrl, feedUrl, items, language, author } = options;
  const base = siteUrl.replace(/\/$/, "");

  // Feed-level updated = most recent item date, or now if no items have dates
  const latestDate = items.find((i) => i.pubDate)?.pubDate ?? new Date();

  const feedMeta = [
    `  <title>${escapeXml(title)}</title>`,
    `  <subtitle>${escapeXml(description)}</subtitle>`,
    `  <link href="${escapeXml(base)}" rel="alternate" type="text/html"/>`,
    `  <link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml"/>`,
    `  <updated>${toIso8601(latestDate)}</updated>`,
    `  <id>${escapeXml(feedUrl)}</id>`,
    author?.name
      ? `  <author>\n    <name>${escapeXml(author.name)}</name>${author.email ? `\n    <email>${escapeXml(author.email)}</email>` : ""}\n  </author>`
      : null,
    `  <generator>Dune CMS</generator>`,
  ].filter(Boolean).join("\n");

  const entryElements = items.map((item) => {
    const updated = item.pubDate ? toIso8601(item.pubDate) : toIso8601(new Date());
    const lines = [
      `  <entry>`,
      `    <title>${escapeXml(item.title)}</title>`,
      `    <link href="${escapeXml(item.link)}" rel="alternate"/>`,
      `    <id>${escapeXml(item.guid)}</id>`,
      `    <updated>${updated}</updated>`,
      item.pubDate ? `    <published>${toIso8601(item.pubDate)}</published>` : null,
      `    <content type="html"><![CDATA[${item.description}]]></content>`,
      `  </entry>`,
    ].filter(Boolean);
    return lines.join("\n");
  });

  const langAttr = language ? ` xml:lang="${escapeXml(language)}"` : "";

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom"${langAttr}>`,
    feedMeta,
    ...entryElements,
    `</feed>`,
  ].join("\n");
}
