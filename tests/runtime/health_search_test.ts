import { assertEquals } from "@std/assert";
import { registerHealthRoutes } from "../../src/runtime/register-health.ts";
import { createSearchManager } from "../../src/search/manager.ts";
import type { SearchEngine } from "../../src/search/engine.ts";
import type { BootstrapResult } from "../../src/runtime/bootstrap.ts";

type Handler = (fc: { url: URL }) => Response | Promise<Response>;

function setup(search?: ReturnType<typeof createSearchManager>) {
  const routes = new Map<string, Handler>();
  // deno-lint-ignore no-explicit-any
  const app = { get: (path: string, h: Handler) => void routes.set(path, h) } as any;
  registerHealthRoutes(app, {
    config: { system: { health_token: "tok" } } as unknown as BootstrapResult["config"],
    engine: { pages: [] } as unknown as BootstrapResult["engine"],
    pageCache: null,
    startTime: Date.now(),
    search,
  });
  const call = async (path: string, query = "") => {
    const res = await routes.get(path)!({ url: new URL(`http://x${path}${query}`) });
    return { status: res.status, body: await res.json() };
  };
  return call;
}

const failing = { build: () => Promise.reject(new Error("down")) } as unknown as SearchEngine;
const ok = {
  build: () => Promise.resolve(),
  rebuild: () => Promise.resolve(),
} as unknown as SearchEngine;

async function degradedManager() {
  const manager = createSearchManager(ok, { retry: { baseMs: 60_000 } });
  manager.register("meilisearch", failing);
  await manager.build();
  return manager;
}

Deno.test("health: ok when search is healthy or not tracked", async () => {
  assertEquals((await setup()("/health")).body, { status: "ok" });
  const manager = createSearchManager(ok);
  await manager.build();
  assertEquals((await setup(manager)("/health")).body, { status: "ok" });
  manager.close();
});

Deno.test("health: a failed search engine reads 'degraded' but stays HTTP 200", async () => {
  const manager = await degradedManager();
  const res = await setup(manager)("/health");
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "degraded" });
  manager.close();
});

Deno.test("health: details (engine names, errors) need the token", async () => {
  const manager = await degradedManager();
  const call = setup(manager);

  assertEquals("search" in (await call("/health", "?detailed=true")).body, false);

  const detailed = (await call("/health", "?detailed=true&token=tok")).body;
  assertEquals(detailed.status, "degraded");
  assertEquals(detailed.search.serving, "built-in");
  assertEquals(
    detailed.search.engines.map((e: { name: string; state: string }) => [e.name, e.state]),
    [["built-in", "ready"], ["meilisearch", "failed"]],
  );
  manager.close();
});

Deno.test("health/ready: degraded search keeps the instance in rotation", async () => {
  const manager = await degradedManager();
  const res = await setup(manager)("/health/ready");
  assertEquals(res.status, 200);
  assertEquals(res.body.degraded, true);
  manager.close();
});
