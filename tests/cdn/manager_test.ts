/**
 * CdnManager tests — batching, URL construction, and empty-input guard.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CdnManager } from "../../src/cdn/manager.ts";
import type { CdnProvider, CdnPurgeRequest } from "../../src/cdn/types.ts";

// ─── Mock provider ────────────────────────────────────────────────────────────

function makeMockProvider(): { provider: CdnProvider; calls: CdnPurgeRequest[] } {
  const calls: CdnPurgeRequest[] = [];
  const provider: CdnProvider = {
    name: "mock",
    async purge(req: CdnPurgeRequest): Promise<void> {
      calls.push({ urls: [...req.urls], tags: req.tags ? [...req.tags] : undefined });
    },
  };
  return { provider, calls };
}

// ─── URL construction ─────────────────────────────────────────────────────────

Deno.test("manager: converts relative routes to absolute URLs", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com" });

  await manager.purgeRoutes(["/blog/hello", "/"]);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].urls, ["https://example.com/blog/hello", "https://example.com/"]);
});

Deno.test("manager: strips trailing slash from baseUrl", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com/" });

  await manager.purgeRoutes(["/about"]);

  assertEquals(calls[0].urls, ["https://example.com/about"]);
});

Deno.test("manager: prepends slash when route lacks leading slash", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com" });

  await manager.purgeRoutes(["blog/hello"]);

  assertEquals(calls[0].urls, ["https://example.com/blog/hello"]);
});

// ─── Batching ─────────────────────────────────────────────────────────────────

Deno.test("manager: single call when routes fit within maxBatchSize", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com", maxBatchSize: 5 });

  const routes = ["/a", "/b", "/c"];
  await manager.purgeRoutes(routes);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].urls.length, 3);
});

Deno.test("manager: batches into multiple calls when routes exceed maxBatchSize", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com", maxBatchSize: 3 });

  const routes = ["/a", "/b", "/c", "/d", "/e", "/f", "/g"];
  await manager.purgeRoutes(routes);

  // 7 routes / batchSize 3 = 3 calls: [3, 3, 1]
  assertEquals(calls.length, 3);
  assertEquals(calls[0].urls.length, 3);
  assertEquals(calls[1].urls.length, 3);
  assertEquals(calls[2].urls.length, 1);
});

Deno.test("manager: all URLs are present across batches", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com", maxBatchSize: 2 });

  await manager.purgeRoutes(["/a", "/b", "/c", "/d"]);

  const all = calls.flatMap((c) => c.urls);
  assertEquals(all, [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/d",
  ]);
});

Deno.test("manager: default maxBatchSize is 30", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com" });

  // 30 routes should produce exactly 1 call
  const routes = Array.from({ length: 30 }, (_, i) => `/page-${i}`);
  await manager.purgeRoutes(routes);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].urls.length, 30);
});

Deno.test("manager: 31 routes produces 2 calls with default maxBatchSize", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com" });

  const routes = Array.from({ length: 31 }, (_, i) => `/page-${i}`);
  await manager.purgeRoutes(routes);

  assertEquals(calls.length, 2);
  assertEquals(calls[0].urls.length, 30);
  assertEquals(calls[1].urls.length, 1);
});

// ─── Empty input guard ────────────────────────────────────────────────────────

Deno.test("manager: empty routes array makes no provider calls", async () => {
  const { provider, calls } = makeMockProvider();
  const manager = new CdnManager({ provider, baseUrl: "https://example.com" });

  await manager.purgeRoutes([]);

  assertEquals(calls.length, 0);
});
