import { assertEquals, assertRejects } from "@std/assert";
import { createSearchManager, SearchConfigError } from "../../src/search/manager.ts";
import type { SearchEngine } from "../../src/search/engine.ts";

function stubEngine(overrides: Partial<SearchEngine> = {}): SearchEngine {
  return {
    build: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    search: () => Promise.resolve([]),
    suggest: () => Promise.resolve([]),
    ...overrides,
  } as unknown as SearchEngine;
}

// With fail_on_startup, a failing engine aborts build() and names itself.
Deno.test("SearchManager.build (fail_on_startup): a failing engine is named and keeps its cause", async () => {
  const original = new TypeError("fetch failed");
  const manager = createSearchManager(stubEngine(), { failOnStartup: true });
  manager.register("meilisearch", stubEngine({ build: () => Promise.reject(original) }));

  const err = await assertRejects(() => manager.build(), Error, 'Search engine "meilisearch" failed to build');
  assertEquals(err.message, 'Search engine "meilisearch" failed to build: fetch failed');
  assertEquals(err.cause, original);
  manager.close();
});

Deno.test("SearchManager.build: a SearchConfigError aborts startup even without fail_on_startup, and is not retried", async () => {
  const manager = createSearchManager(stubEngine(), { retry: { baseMs: 5 } });
  manager.register("meilisearch", stubEngine({ build: () => Promise.reject(new SearchConfigError("invalid API key")) }));

  await assertRejects(() => manager.build(), Error, 'Search engine "meilisearch" failed to build: invalid API key');
  assertEquals(manager.status().find((s) => s.name === "meilisearch")?.nextRetryAt, undefined);
  manager.close();
});
