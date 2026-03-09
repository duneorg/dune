import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateAtom, generateRss } from "../../src/feeds/generator.ts";
import type { FeedItem, FeedOptions } from "../../src/feeds/generator.ts";

function makeOptions(overrides: Partial<FeedOptions> = {}): FeedOptions {
  return {
    title: "My Blog",
    description: "Latest posts",
    siteUrl: "https://example.com",
    feedUrl: "https://example.com/feed.xml",
    items: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    title: "Hello World",
    link: "https://example.com/hello",
    guid: "https://example.com/hello",
    pubDate: new Date("2026-01-15T12:00:00Z"),
    description: "<p>Test content</p>",
    ...overrides,
  };
}

// ── RSS 2.0 tests ────────────────────────────────────────────────────────────

Deno.test("generateRss: produces valid XML declaration and rss root", () => {
  const xml = generateRss(makeOptions());

  assertStringIncludes(xml, '<?xml version="1.0" encoding="UTF-8"?>');
  assertStringIncludes(xml, '<rss version="2.0"');
  assertStringIncludes(xml, "</rss>");
  assertStringIncludes(xml, "<channel>");
  assertStringIncludes(xml, "</channel>");
});

Deno.test("generateRss: includes channel metadata", () => {
  const xml = generateRss(makeOptions({
    title: "My Blog",
    description: "Latest posts",
    siteUrl: "https://example.com",
    feedUrl: "https://example.com/feed.xml",
    language: "en",
  }));

  assertStringIncludes(xml, "<title>My Blog</title>");
  assertStringIncludes(xml, "<link>https://example.com</link>");
  assertStringIncludes(xml, "<description>Latest posts</description>");
  assertStringIncludes(xml, "<language>en</language>");
  assertStringIncludes(xml, 'rel="self"');
  assertStringIncludes(xml, "https://example.com/feed.xml");
});

Deno.test("generateRss: includes atom:link self-reference", () => {
  const xml = generateRss(makeOptions({ feedUrl: "https://example.com/feed.xml" }));

  assertStringIncludes(xml, 'xmlns:atom="http://www.w3.org/2005/Atom"');
  assertStringIncludes(xml, 'rel="self"');
  assertStringIncludes(xml, "https://example.com/feed.xml");
});

Deno.test("generateRss: renders one <item> per feed item", () => {
  const items = [makeItem({ title: "Post A" }), makeItem({ title: "Post B", link: "https://example.com/b", guid: "https://example.com/b" })];
  const xml = generateRss(makeOptions({ items }));

  assertStringIncludes(xml, "<title>Post A</title>");
  assertStringIncludes(xml, "<title>Post B</title>");
  assertEquals((xml.match(/<item>/g) ?? []).length, 2);
});

Deno.test("generateRss: item contains link, guid, description", () => {
  const xml = generateRss(makeOptions({ items: [makeItem()] }));

  assertStringIncludes(xml, "<link>https://example.com/hello</link>");
  assertStringIncludes(xml, '<guid isPermaLink="true">https://example.com/hello</guid>');
  assertStringIncludes(xml, "<![CDATA[<p>Test content</p>]]>");
});

Deno.test("generateRss: item pubDate is RFC-822 format", () => {
  const xml = generateRss(makeOptions({ items: [makeItem({ pubDate: new Date("2026-01-15T12:00:00Z") })] }));

  // RFC-822: "Thu, 15 Jan 2026 12:00:00 +0000"
  assertStringIncludes(xml, "<pubDate>");
  assertStringIncludes(xml, "2026");
  assertStringIncludes(xml, "+0000");
});

Deno.test("generateRss: empty items produces valid XML with no <item>", () => {
  const xml = generateRss(makeOptions({ items: [] }));

  assertStringIncludes(xml, "<channel>");
  assertStringIncludes(xml, "</channel>");
  assertEquals(xml.includes("<item>"), false);
});

Deno.test("generateRss: escapes XML special chars in title", () => {
  const xml = generateRss(makeOptions({ title: "A & B <test>" }));

  assertStringIncludes(xml, "A &amp; B &lt;test&gt;");
  assertEquals(xml.includes("A & B <test>"), false);
});

Deno.test("generateRss: item without pubDate omits pubDate element", () => {
  const xml = generateRss(makeOptions({ items: [makeItem({ pubDate: null })] }));

  assertEquals(xml.includes("<pubDate>"), false);
});

// ── Atom 1.0 tests ──────────────────────────────────────────────────────────

Deno.test("generateAtom: produces valid XML declaration and feed root", () => {
  const xml = generateAtom(makeOptions());

  assertStringIncludes(xml, '<?xml version="1.0" encoding="UTF-8"?>');
  assertStringIncludes(xml, '<feed xmlns="http://www.w3.org/2005/Atom"');
  assertStringIncludes(xml, "</feed>");
});

Deno.test("generateAtom: includes feed metadata", () => {
  const xml = generateAtom(makeOptions({
    title: "My Blog",
    description: "Latest posts",
    siteUrl: "https://example.com",
    feedUrl: "https://example.com/atom.xml",
  }));

  assertStringIncludes(xml, "<title>My Blog</title>");
  assertStringIncludes(xml, "<subtitle>Latest posts</subtitle>");
  assertStringIncludes(xml, 'rel="alternate"');
  assertStringIncludes(xml, 'rel="self"');
  assertStringIncludes(xml, "https://example.com/atom.xml");
});

Deno.test("generateAtom: renders one <entry> per feed item", () => {
  const items = [makeItem({ title: "Alpha" }), makeItem({ title: "Beta", link: "https://example.com/beta", guid: "https://example.com/beta" })];
  const xml = generateAtom(makeOptions({ items }));

  assertStringIncludes(xml, "<title>Alpha</title>");
  assertStringIncludes(xml, "<title>Beta</title>");
  assertEquals((xml.match(/<entry>/g) ?? []).length, 2);
});

Deno.test("generateAtom: entry contains id, updated, content", () => {
  const xml = generateAtom(makeOptions({ items: [makeItem()] }));

  assertStringIncludes(xml, "<id>https://example.com/hello</id>");
  assertStringIncludes(xml, "<updated>");
  assertStringIncludes(xml, '<content type="html">');
  assertStringIncludes(xml, "<![CDATA[<p>Test content</p>]]>");
});

Deno.test("generateAtom: entry updated date is ISO-8601", () => {
  const xml = generateAtom(makeOptions({ items: [makeItem({ pubDate: new Date("2026-01-15T12:00:00Z") })] }));

  assertStringIncludes(xml, "<updated>2026-01-15T12:00:00.000Z</updated>");
});

Deno.test("generateAtom: feed updated reflects most recent item date", () => {
  const items = [
    makeItem({ pubDate: new Date("2026-03-01T00:00:00Z") }),
    makeItem({ pubDate: new Date("2026-01-15T00:00:00Z"), link: "https://example.com/old", guid: "https://example.com/old" }),
  ];
  const xml = generateAtom(makeOptions({ items }));

  // Feed-level <updated> should use the first (most recent) item's date
  const feedUpdatedMatch = xml.match(/<updated>([^<]+)<\/updated>/);
  assertEquals(feedUpdatedMatch !== null, true);
  assertStringIncludes(feedUpdatedMatch![1], "2026-03-01");
});

Deno.test("generateAtom: language sets xml:lang attribute", () => {
  const xml = generateAtom(makeOptions({ language: "de" }));

  assertStringIncludes(xml, 'xml:lang="de"');
});

Deno.test("generateAtom: empty items produces valid XML with no <entry>", () => {
  const xml = generateAtom(makeOptions({ items: [] }));

  assertStringIncludes(xml, '<feed xmlns="http://www.w3.org/2005/Atom"');
  assertEquals(xml.includes("<entry>"), false);
});
