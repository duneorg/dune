import { assertEquals } from "@std/assert";
import { createSearchAnalytics, MAX_QUERY_LENGTH } from "../../src/search/analytics.ts";

async function withDir(fn: (path: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  try {
    await fn(`${dir}/state/search-analytics.json`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// A long interval keeps the timer out of the way: tests flush explicitly.
const mk = (path: string, opts: { maxQueries?: number } = {}) =>
  createSearchAnalytics(path, { flushIntervalMs: 3_600_000, ...opts });

Deno.test("analytics: queries are normalised and aggregated, not logged one by one", async () => {
  await withDir(async (path) => {
    const a = mk(path);
    a.record({ query: "  Deno  ", resultCount: 4, timestamp: 100 });
    a.record({ query: "deno", resultCount: 2, timestamp: 200 });
    a.record({ query: "DENO\t", resultCount: 3, timestamp: 300 });
    a.record({ query: "two   words", resultCount: 0, timestamp: 400 });
    a.record({ query: "two words", resultCount: 0, timestamp: 500 });
    a.record({ query: "   ", resultCount: 1, timestamp: 600 });
    const s = await a.summarize();
    assertEquals(s.totalSearches, 5);
    assertEquals(s.since, 100);
    assertEquals(s.topQueries, [
      { query: "deno", count: 3, avgResults: 3 },
      { query: "two words", count: 2, avgResults: 0 },
    ]);
    assertEquals(s.zeroResultQueries, [{ query: "two words", count: 2 }]);
  });
});

Deno.test("analytics: over-long queries are truncated", async () => {
  await withDir(async (path) => {
    const a = mk(path);
    a.record({ query: "x".repeat(MAX_QUERY_LENGTH * 3), resultCount: 1, timestamp: 1 });
    const s = await a.summarize();
    assertEquals(s.topQueries[0].query.length, MAX_QUERY_LENGTH);
  });
});

Deno.test("analytics: memory and disk stay bounded; the lowest-count query is evicted first", async () => {
  await withDir(async (path) => {
    const a = mk(path, { maxQueries: 3 });
    for (let i = 0; i < 5; i++) a.record({ query: "popular", resultCount: 1, timestamp: i });
    for (let i = 0; i < 2; i++) a.record({ query: "common", resultCount: 1, timestamp: i });
    // a flood of one-off queries must not displace the frequent ones
    for (let i = 0; i < 500; i++) a.record({ query: `junk ${i}`, resultCount: 0, timestamp: i });
    const s = await a.summarize(100);
    assertEquals(s.topQueries.length, 3);
    assertEquals(s.topQueries.slice(0, 2).map((q) => q.query), ["popular", "common"]);
    assertEquals(s.totalSearches, 507, "the total keeps counting every search");
    await a.flush();
    const snap = JSON.parse(await Deno.readTextFile(path));
    assertEquals(Object.keys(snap.queries).length, 3);
  });
});

Deno.test("analytics: counts survive a restart and keep accumulating", async () => {
  await withDir(async (path) => {
    const first = mk(path);
    first.record({ query: "deno", resultCount: 2, timestamp: 10 });
    first.record({ query: "deno", resultCount: 2, timestamp: 20 });
    await first.flush();

    const second = mk(path);
    second.record({ query: "deno", resultCount: 2, timestamp: 30 }); // races the load; must not be lost
    const s = await second.summarize();
    assertEquals(s.totalSearches, 3);
    assertEquals(s.since, 10);
    assertEquals(s.topQueries, [{ query: "deno", count: 3, avgResults: 2 }]);
  });
});

Deno.test("analytics: nothing is written until something is recorded, and unchanged counts are not rewritten", async () => {
  await withDir(async (path) => {
    const a = mk(path);
    await a.flush();
    assertEquals(await Deno.stat(path).then(() => true, () => false), false);
    a.record({ query: "deno", resultCount: 1, timestamp: 1 });
    await a.flush();
    const mtime = (await Deno.stat(path)).mtime!.getTime();
    await new Promise((r) => setTimeout(r, 20));
    await a.flush();
    assertEquals((await Deno.stat(path)).mtime!.getTime(), mtime);
  });
});

Deno.test("analytics: the debounced flush writes on its own", async () => {
  await withDir(async (path) => {
    const a = createSearchAnalytics(path, { flushIntervalMs: 20 });
    a.record({ query: "deno", resultCount: 1, timestamp: 1 });
    for (let i = 0; i < 50; i++) {
      if (await Deno.stat(path).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assertEquals(JSON.parse(await Deno.readTextFile(path)).totalSearches, 1);
  });
});

Deno.test("analytics: an unreadable snapshot starts empty instead of failing", async () => {
  await withDir(async (path) => {
    await Deno.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
    await Deno.writeTextFile(path, "{not json");
    const s = await mk(path).summarize();
    assertEquals(s, { totalSearches: 0, since: null, topQueries: [], zeroResultQueries: [] });
  });
});
