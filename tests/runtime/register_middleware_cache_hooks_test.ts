/**
 * Regression tests for onCacheHit/onCacheMiss (0.31.7), fired from
 * register-middleware.ts's page-cache lookup in the real request path.
 *
 * Uses a real bootstrap() + createDuneApp() against a temp site with
 * page_cache enabled, driven through App.handler() with real fetch
 * Requests — same pattern as tests/cli/fresh-app_test.ts.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries — sanitizeOps/sanitizeResources off, best-effort cleanup.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

async function withCachedApp(
  markerPath: string,
  fn: (handler: (req: Request) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_cache_hooks_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHello\n",
    );
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      `title: Test Site\nurl: http://localhost:3000\nplugins:\n  - src: ./plugins/cache-probe.ts\n`,
    );
    await Deno.writeTextFile(
      join(root, "config", "system.yaml"),
      "page_cache:\n  enabled: true\n",
    );
    await Deno.mkdir(join(root, "plugins"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "plugins", "cache-probe.ts"),
      `export default {
        name: "cache-probe",
        version: "1.0.0",
        hooks: {
          async onCacheHit(ctx) {
            await Deno.writeTextFile("${markerPath}", JSON.stringify({ event: "hit", key: ctx.data.key }));
          },
          async onCacheMiss(ctx) {
            await Deno.writeTextFile("${markerPath}", JSON.stringify({ event: "miss", key: ctx.data.key }));
          },
        },
      };\n`,
    );

    const ctx = await bootstrap(root, {});
    // dev: false — the page cache is only consulted outside dev mode.
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();

    await fn(handler);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "registerContentCatchAll: fires onCacheMiss on first request, onCacheHit on the second",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const markerPath = await Deno.makeTempFile({ prefix: "dune_cache_marker_" });
    try {
      await withCachedApp(markerPath, async (handler) => {
        // First request: page cache is empty -> should be a miss.
        const first = await handler(new Request("http://localhost/home/"));
        assertEquals(first.status, 200);
        const missMarker = JSON.parse(await Deno.readTextFile(markerPath));
        assertEquals(missMarker.event, "miss");
        assertEquals(missMarker.key, "/home/");

        // Second request to the same route: should now be a cache hit.
        const second = await handler(new Request("http://localhost/home/"));
        assertEquals(second.status, 200);
        const hitMarker = JSON.parse(await Deno.readTextFile(markerPath));
        assertEquals(hitMarker.event, "hit");
        assertEquals(hitMarker.key, "/home/");
      });
    } finally {
      await Deno.remove(markerPath).catch(() => {});
    }
  },
);
