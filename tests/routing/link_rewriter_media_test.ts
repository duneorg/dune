import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rewriteInternalLinks,
  stripLangPrefix,
} from "../../src/routing/link-rewriter.ts";

const rw = (html: string) =>
  rewriteInternalLinks(html, "de", "en", false, ["en", "de", "fr"]);

Deno.test("rewriteInternalLinks: leaves co-located media hrefs unprefixed", () => {
  for (
    const href of [
      "/truenorth/newcomers/doc.pdf",
      "/a/b/Clip.MP3",
      "/a/b/doc.pdf?download=1",
      "/a/b/doc.pdf#page=2",
    ]
  ) {
    assertEquals(rw(`<a href="${href}">x</a>`), `<a href="${href}">x</a>`);
  }
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
