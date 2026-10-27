import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { MediaFile } from "../../src/content/types.ts";
import {
  rewriteInternalLinks,
  stripLangPrefix,
} from "../../src/routing/link-rewriter.ts";

const media = (url: string) => ({ url } as MediaFile);
const rw = (html: string, m: MediaFile[] = []) =>
  rewriteInternalLinks(html, "de", "en", false, ["en", "de", "fr"], m);
const OWN = [
  media("/truenorth/newcomers/doc.pdf"),
  media("/truenorth/newcomers/data.json"),
];

Deno.test("rewriteInternalLinks: leaves the page's own co-located files unprefixed", () => {
  for (
    const href of [
      "/truenorth/newcomers/doc.pdf",
      "/truenorth/newcomers/data.json",
      "/truenorth/newcomers/doc.pdf?download=1",
      "/truenorth/newcomers/doc.pdf#page=2",
    ]
  ) {
    assertEquals(rw(`<a href="${href}">x</a>`, OWN), `<a href="${href}">x</a>`);
  }
});

Deno.test("rewriteInternalLinks: page routes that look like files are still prefixed", () => {
  assertEquals(rw('<a href="/old-page.html">x</a>', OWN), '<a href="/de/old-page.html">x</a>');
  assertEquals(rw('<a href="/pricing.json">x</a>', OWN), '<a href="/de/pricing.json">x</a>');
  // Not this page's file: prefixed (the media handler accepts /de/... URLs).
  assertEquals(rw('<a href="/other/doc.pdf">x</a>', OWN), '<a href="/de/other/doc.pdf">x</a>');
});

Deno.test("rewriteInternalLinks: still prefixes page links, including dotted slugs", () => {
  assertEquals(rw('<a href="/contact">x</a>'), '<a href="/de/contact">x</a>');
  assertEquals(rw('<a href="/v1.2/notes">x</a>'), '<a href="/de/v1.2/notes">x</a>');
  assertEquals(rw('<a href="/a/b?file=doc.pdf">x</a>'), '<a href="/de/a/b?file=doc.pdf">x</a>');
});

Deno.test("stripLangPrefix: strips only a supported leading language segment", () => {
  const langs = ["en", "de"];
  assertEquals(stripLangPrefix("/de/a/doc.pdf", langs), "/a/doc.pdf");
  assertEquals(stripLangPrefix("/a/doc.pdf", langs), "/a/doc.pdf");
  assertEquals(stripLangPrefix("/fr/a/doc.pdf", langs), "/fr/a/doc.pdf");
  assertEquals(stripLangPrefix("/de", langs), "/de");
  assertEquals(stripLangPrefix("/de/", langs), "/de/");
});
