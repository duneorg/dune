/**
 * A search backend that is down must not take the site down: engines build
 * independently, search falls back, a failed engine is retried and recovers.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { createSearchManager, SearchUnavailableError } from "../../src/search/manager.ts";
import type { SearchEngine, SearchResult } from "../../src/search/engine.ts";
import type { PageIndex } from "../../src/content/types.ts";

const hit = (route: string, score = 1) =>
  ({ page: { route }, score, matches: [] }) as unknown as SearchResult;

function stubEngine(overrides: Partial<SearchEngine> = {}): SearchEngine {
  return {
    build: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    search: () => Promise.resolve([]),
    suggest: () => Promise.resolve([]),
    ...overrides,
  } as unknown as SearchEngine;
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition never became true");
    await tick(5);
  }
}

/** An engine that fails its first `failures` build/rebuild calls. */
function flaky(failures: number, extra: Partial<SearchEngine> = {}) {
  let left = failures;
  const calls = { build: 0, rebuild: [] as PageIndex[][] };
  const engine = stubEngine({
    build: () => {
      calls.build++;
      return left-- > 0 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve();
    },
    rebuild: (pages) => {
      calls.rebuild.push(pages);
      return left-- > 0 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve();
    },
    search: () => Promise.resolve([hit("/from-meili")]),
    ...extra,
  });
  return { engine, calls };
}

Deno.test("build: one failing engine does not abort startup or the others", async () => {
  let builtInBuilt = false;
  const manager = createSearchManager(
    stubEngine({ build: () => (builtInBuilt = true, Promise.resolve()) }),
  );
  manager.register("meilisearch", flaky(99).engine);
  manager.setActiveEngine("meilisearch");

  await manager.build();

  assertEquals(builtInBuilt, true);
  const [builtIn, meili] = manager.status();
  assertEquals([builtIn.state, meili.state], ["ready", "failed"]);
  assertEquals(meili.active, true);
  assertEquals(meili.error, 'Search engine "meilisearch" failed to build: fetch failed');
  assertEquals(manager.isDegraded(), true);
  manager.close();
});

Deno.test("search: falls back to the built-in engine while the active one is failed", async () => {
  const manager = createSearchManager(
    stubEngine({ search: () => Promise.resolve([hit("/from-builtin")]) }),
  );
  manager.register("meilisearch", flaky(99).engine);
  manager.setActiveEngine("meilisearch");
  await manager.build();

  assertEquals(manager.servingEngineName(), "built-in");
  assertEquals((await manager.search("x"))[0].page.route, "/from-builtin");
  manager.close();
});

Deno.test("retry: a failed engine recovers in the background and takes over again", async () => {
  const meili = flaky(2);
  const manager = createSearchManager(
    stubEngine({ search: () => Promise.resolve([hit("/from-builtin")]) }),
    { retry: { baseMs: 10, maxMs: 40 } },
  );
  manager.register("meilisearch", meili.engine);
  manager.setActiveEngine("meilisearch");
  await manager.build();
  assertEquals(manager.servingEngineName(), "built-in");

  await until(() => manager.status()[1].state === "ready");

  assertEquals(meili.calls.build, 3); // initial + two retries
  assertEquals(manager.isDegraded(), false);
  assertEquals(manager.servingEngineName(), "meilisearch");
  assertEquals((await manager.search("x"))[0].page.route, "/from-meili");
  assertEquals(manager.status()[1].attempts, 0);
  manager.close();
});

Deno.test("retry: backoff doubles up to the cap", async () => {
  const manager = createSearchManager(stubEngine(), { retry: { baseMs: 20, maxMs: 50 } });
  manager.register("meilisearch", flaky(99).engine);
  await manager.build();

  const delay = () => manager.status()[1].nextRetryAt! - Date.now();
  assert(delay() <= 20 && delay() > 5, `first delay ${delay()}`);
  await until(() => manager.status()[1].attempts === 2);
  assert(delay() > 25 && delay() <= 40, `second delay ${delay()}`);
  await until(() => manager.status()[1].attempts === 3);
  assert(delay() > 30 && delay() <= 50, `third delay is capped, got ${delay()}`);
  manager.close();
});

Deno.test("rebuild: a failure degrades the engine and the retry re-indexes the latest pages", async () => {
  const meili = flaky(0);
  const manager = createSearchManager(stubEngine(), { retry: { baseMs: 10 } });
  manager.register("meilisearch", meili.engine);
  await manager.build();
  assertEquals(manager.status()[1].state, "ready");

  // The next rebuild call fails, then recovers.
  let fail = true;
  meili.engine.rebuild = (pages) => {
    meili.calls.rebuild.push(pages);
    return fail ? (fail = false, Promise.reject(new Error("503"))) : Promise.resolve();
  };
  const pagesA = [{ route: "/a" }] as unknown as PageIndex[];
  const pagesB = [{ route: "/b" }] as unknown as PageIndex[];
  await manager.rebuild(pagesA); // does not throw
  assertEquals(manager.status()[1].state, "failed");
  await manager.rebuild(pagesB);
  await until(() => manager.status()[1].state === "ready");

  assertEquals(meili.calls.rebuild.at(-1), pagesB);
  manager.close();
});

Deno.test("search: a query error on a ready engine falls back for that request without marking it failed", async () => {
  const manager = createSearchManager(
    stubEngine({ search: () => Promise.resolve([hit("/from-builtin")]) }),
  );
  manager.register(
    "meilisearch",
    stubEngine({ search: () => Promise.reject(new Error("socket closed")) }),
  );
  manager.setActiveEngine("meilisearch");
  await manager.build();

  assertEquals((await manager.search("x"))[0].page.route, "/from-builtin");
  assertEquals(manager.status()[1].state, "ready");
  manager.close();
});

Deno.test("search: nothing usable is a SearchUnavailableError, for search, suggest and facets", async () => {
  const manager = createSearchManager(flaky(99).engine);
  await manager.build();

  await assertRejects(() => manager.search("x"), SearchUnavailableError);
  await assertRejects(() => manager.suggest("x"), SearchUnavailableError);
  await assertRejects(() => manager.facetCounts!("x", "f"), SearchUnavailableError);
  assertEquals(manager.servingEngineName(), null);
  manager.close();
});

Deno.test("search: every candidate failing the query is a SearchUnavailableError with the cause", async () => {
  const manager = createSearchManager(stubEngine({ search: () => Promise.reject(new Error("a")) }));
  manager.register("meilisearch", stubEngine({ search: () => Promise.reject(new Error("b")) }));
  await manager.build();
  const err = await assertRejects(() => manager.search("x"), SearchUnavailableError);
  assertEquals((err.cause as Error).message.length, 1);
  manager.close();
});

Deno.test("search: a lone engine's query error is not disguised as 'unavailable'", async () => {
  const manager = createSearchManager(
    stubEngine({ search: () => Promise.reject(new RangeError("bad")) }),
  );
  await manager.build();
  await assertRejects(() => manager.search("x"), RangeError, "bad");
  manager.close();
});

Deno.test("search: before build() engines are usable (buildSearch off keeps working)", async () => {
  const manager = createSearchManager(stubEngine({ search: () => Promise.resolve([hit("/x")]) }));
  assertEquals((await manager.search("x")).length, 1);
  assertEquals(manager.status()[0].state, "pending");
  manager.close();
});

Deno.test("parallel mode queries only usable engines", async () => {
  const manager = createSearchManager(
    stubEngine({ search: () => Promise.resolve([hit("/builtin")]) }),
  );
  const meili = flaky(99, { search: () => Promise.resolve([hit("/meili", 9)]) });
  manager.register("meilisearch", meili.engine);
  manager.setParallelMode(true);
  await manager.build();
  assertEquals((await manager.search("x")).map((r) => r.page.route), ["/builtin"]);
  manager.close();
});

Deno.test("register: replacing an engine cancels its pending retry", async () => {
  const old = flaky(99);
  const manager = createSearchManager(stubEngine(), { retry: { baseMs: 10 } });
  manager.register("meilisearch", old.engine);
  await manager.build();
  manager.register("meilisearch", stubEngine());
  const before = old.calls.build;
  await tick(60);
  assertEquals(old.calls.build, before);
  assertEquals(manager.status()[1].state, "pending");
  manager.close();
});

Deno.test("close: stops retrying", async () => {
  const meili = flaky(99);
  const manager = createSearchManager(stubEngine(), { retry: { baseMs: 10 } });
  manager.register("meilisearch", meili.engine);
  await manager.build();
  manager.close();
  const calls = meili.calls.build;
  await tick(60);
  assertEquals(meili.calls.build, calls);
});
