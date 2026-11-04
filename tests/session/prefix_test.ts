import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  assertValidSessionPrefix,
  resolveSessionPrefix,
} from "../../src/session/prefix.ts";
import { bootstrap } from "../../src/runtime/bootstrap.ts";

Deno.test("resolveSessionPrefix: configured wins, multisite derives, single-site stays unprefixed", () => {
  assertEquals(resolveSessionPrefix("custom", "blog"), "custom");
  assertEquals(resolveSessionPrefix(undefined, "blog"), "dune:blog");
  assertEquals(resolveSessionPrefix(undefined, undefined), undefined);
  assertEquals(resolveSessionPrefix("", undefined), undefined);
});

Deno.test("resolveSessionPrefix: odd site ids are made key-safe and bounded", () => {
  assertEquals(resolveSessionPrefix(undefined, "my site/1"), "dune:my_site_1");
  const long = resolveSessionPrefix(undefined, "x".repeat(200))!;
  assertEquals(long.length, 64);
  assertValidSessionPrefix(long);
});

Deno.test("assertValidSessionPrefix rejects empty, spaces and oversize", () => {
  assertValidSessionPrefix("dune:blog-1.a_b");
  for (const bad of ["", "a b", "a/b", "x".repeat(65)]) {
    assertThrows(() => assertValidSessionPrefix(bad), Error, "session_store.prefix");
  }
});

async function withSite(
  systemYaml: string,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_sess_prefix_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      "title: T\nurl: http://localhost:3000\n",
    );
    await Deno.writeTextFile(join(root, "config", "system.yaml"), systemYaml);
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\nhi\n",
    );
    await fn(root);
  } finally {
    // bootstrap may still be writing under .dune/ (index, caches); retry briefly.
    for (let i = 0; i < 5; i++) {
      try {
        await Deno.remove(root, { recursive: true });
        break;
      } catch (err) {
        if (i === 4) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("bootstrap: a multisite site gets a site-scoped session prefix", opts, async () => {
  await withSite("session_store:\n  type: redis\n  url: redis://x\n", async (root) => {
    const ctx = await bootstrap(root, { siteId: "blog" });
    assertEquals(ctx.config.system.session_store?.prefix, "dune:blog");
    assertEquals(ctx.config.system.session_store?.type, "redis");
  });
});

Deno.test("bootstrap: a configured prefix is kept; single-site stays unprefixed", opts, async () => {
  await withSite("session_store:\n  type: redis\n  url: redis://x\n  prefix: mine\n", async (root) => {
    const ctx = await bootstrap(root, { siteId: "blog" });
    assertEquals(ctx.config.system.session_store?.prefix, "mine");
  });
  await withSite("session_store:\n  type: redis\n  url: redis://x\n", async (root) => {
    const ctx = await bootstrap(root, {});
    assertEquals(ctx.config.system.session_store?.prefix, undefined);
  });
});
