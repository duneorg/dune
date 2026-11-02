import { assertRejects, assertEquals } from "@std/assert";
import { createSearchManager } from "../../src/search/manager.ts";
import type { SearchEngine } from "../../src/search/engine.ts";

function stubEngine(overrides: Partial<SearchEngine> = {}): SearchEngine {
  return {
    build: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    search: () => Promise.resolve([]),
    ...overrides,
  } as unknown as SearchEngine;
}

Deno.test("SearchManager.build: a failing engine is named and keeps its cause", async () => {
  const original = new TypeError("fetch failed");
  const manager = createSearchManager(stubEngine());
  manager.register("meilisearch", stubEngine({ build: () => Promise.reject(original) }));

  const err = await assertRejects(() => manager.build(), Error, 'Search engine "meilisearch" failed to build');
  assertEquals(err.message, 'Search engine "meilisearch" failed to build: fetch failed');
  assertEquals(err.cause, original);
});

Deno.test("SearchManager.rebuild: a failing engine is named", async () => {
  const manager = createSearchManager(stubEngine());
  manager.register("orama", stubEngine({ rebuild: () => Promise.reject(new Error("bad index")) }));
  await assertRejects(() => manager.rebuild([]), Error, 'Search engine "orama" failed to rebuild: bad index');
});
