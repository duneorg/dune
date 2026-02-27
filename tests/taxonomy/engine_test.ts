import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createTaxonomyEngine } from "../../src/taxonomy/engine.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { TaxonomyMap } from "../../src/content/index-builder.ts";

function makePage(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.home/default.md",
    route: "/home",
    language: "en",
    format: "md",
    template: "default",
    title: "Home",
    navTitle: "Home",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

const post1 = makePage({ sourcePath: "blog/post1/default.md", route: "/blog/post1", title: "Post 1", taxonomy: { tag: ["deno", "fresh"], category: ["tutorials"] } });
const post2 = makePage({ sourcePath: "blog/post2/default.md", route: "/blog/post2", title: "Post 2", taxonomy: { tag: ["deno"], category: ["news"] } });
const post3 = makePage({ sourcePath: "blog/post3/default.md", route: "/blog/post3", title: "Post 3", published: false, taxonomy: { tag: ["deno"] } });

const taxMap: TaxonomyMap = {
  tag: {
    deno: ["blog/post1/default.md", "blog/post2/default.md", "blog/post3/default.md"],
    fresh: ["blog/post1/default.md"],
  },
  category: {
    tutorials: ["blog/post1/default.md"],
    news: ["blog/post2/default.md"],
  },
};

Deno.test("taxonomy.find: returns published pages for a tag", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2, post3], taxonomyMap: taxMap });
  const results = engine.find("tag", "deno");
  // post3 is unpublished
  assertEquals(results.length, 2);
  assertEquals(results.map(p => p.route).sort(), ["/blog/post1", "/blog/post2"]);
});

Deno.test("taxonomy.find: returns empty for unknown taxonomy", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  assertEquals(engine.find("unknown", "value"), []);
});

Deno.test("taxonomy.find: returns empty for unknown value", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  assertEquals(engine.find("tag", "nonexistent"), []);
});

Deno.test("taxonomy.find: single-value tag returns one page", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  const results = engine.find("tag", "fresh");
  assertEquals(results.length, 1);
  assertEquals(results[0].route, "/blog/post1");
});

Deno.test("taxonomy.findAll: AND intersection across taxonomies", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  // post1 has both tag=deno AND category=tutorials; post2 has tag=deno but category=news
  const results = engine.findAll({ tag: "deno", category: "tutorials" });
  assertEquals(results.length, 1);
  assertEquals(results[0].route, "/blog/post1");
});

Deno.test("taxonomy.findAll: no intersection returns empty", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  const results = engine.findAll({ tag: "fresh", category: "news" });
  assertEquals(results.length, 0);
});

Deno.test("taxonomy.findAll: unknown taxonomy returns empty", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  assertEquals(engine.findAll({ ghost: "value" }), []);
});

Deno.test("taxonomy.findAny: OR union across values", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2, post3], taxonomyMap: taxMap });
  const results = engine.findAny("tag", ["deno", "fresh"]);
  // post3 is unpublished, so only post1 and post2
  assertEquals(results.length, 2);
});

Deno.test("taxonomy.findAny: returns empty for unknown taxonomy", () => {
  const engine = createTaxonomyEngine({ pages: [post1], taxonomyMap: taxMap });
  assertEquals(engine.findAny("ghost", ["anything"]), []);
});

Deno.test("taxonomy.findAny: deduplicates pages matched by multiple values", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });
  // post1 matches both "deno" and "fresh" — should appear once
  const results = engine.findAny("tag", ["deno", "fresh"]);
  const routes = results.map(p => p.route);
  assertEquals(new Set(routes).size, routes.length); // no duplicates
});

Deno.test("taxonomy.values: counts only published pages", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2, post3], taxonomyMap: taxMap });
  const counts = engine.values("tag");
  // post3 unpublished → deno count is 2, not 3
  assertEquals(counts["deno"], 2);
  assertEquals(counts["fresh"], 1);
});

Deno.test("taxonomy.values: returns empty object for unknown taxonomy", () => {
  const engine = createTaxonomyEngine({ pages: [post1], taxonomyMap: taxMap });
  assertEquals(engine.values("nonexistent"), {});
});

Deno.test("taxonomy.names: lists all taxonomy names", () => {
  const engine = createTaxonomyEngine({ pages: [post1], taxonomyMap: taxMap });
  const names = engine.names().sort();
  assertEquals(names, ["category", "tag"]);
});

Deno.test("taxonomy.map: returns full taxonomy map", () => {
  const engine = createTaxonomyEngine({ pages: [post1], taxonomyMap: taxMap });
  assertEquals(engine.map(), taxMap);
});

Deno.test("taxonomy.rebuild: swaps internal state", () => {
  const engine = createTaxonomyEngine({ pages: [post1, post2], taxonomyMap: taxMap });

  const newPage = makePage({ sourcePath: "about/default.md", route: "/about", taxonomy: { tag: ["preact"] } });
  const newMap: TaxonomyMap = { tag: { preact: ["about/default.md"] } };
  engine.rebuild([newPage], newMap);

  assertEquals(engine.names(), ["tag"]);
  assertEquals(engine.find("tag", "preact").length, 1);
  assertEquals(engine.find("tag", "deno").length, 0);
});

Deno.test("taxonomy.find: excludes unpublished even after rebuild", () => {
  const engine = createTaxonomyEngine({ pages: [], taxonomyMap: {} });
  const unpub = makePage({ sourcePath: "secret/default.md", published: false, taxonomy: { tag: ["x"] } });
  engine.rebuild([unpub], { tag: { x: ["secret/default.md"] } });
  assertEquals(engine.find("tag", "x"), []);
});
