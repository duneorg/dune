/**
 * After `engine.rebuild()` the taxonomy, the collections and search follow the
 * new page index, and plugin-injected search records are collected again.
 * Before this, only `dune dev` and the multisite watcher did it: a production
 * server never did, so a page written at runtime was not searchable, not in its
 * taxonomy terms and missing from collections until a restart (#145).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";
import type { InjectedSearchRecord } from "../../src/search/engine.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function withSite(
  plugins: DunePlugin[],
  buildSearch: boolean,
  fn: (ctx: Awaited<ReturnType<typeof bootstrap>>, root: string) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_refresh_derived_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: T\nurl: http://localhost\ntaxonomies:\n  - tag\n");
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\ntaxonomy:\n  tag: [a]\n---\n\nHello\n",
    );
    const ctx = await bootstrap(root, { plugins, buildSearch });
    await fn(ctx, root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function addPage(root: string, dir: string, body: string) {
  await Deno.mkdir(join(root, "content", dir), { recursive: true });
  await Deno.writeTextFile(
    join(root, "content", dir, "default.md"),
    `---\ntitle: ${dir}\ntaxonomy:\n  tag: [a]\n---\n\n${body}\n`,
  );
}

/** Search refreshes in the background: wait until `check` holds (or fail after a few seconds). */
async function eventually(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`never became true: ${what}`);
}

// deno-lint-ignore no-explicit-any
const tagPages = (ctx: any) => ctx.taxonomy.find("tag", "a").length as number;

Deno.test("a page written at runtime is in its taxonomy term and searchable after engine.rebuild()", opts, async () => {
  await withSite([], true, async (ctx, root) => {
    assertEquals(tagPages(ctx), 1);
    assertEquals((await ctx.search.search("zebrafish")).length, 0);
    await addPage(root, "02.new", "zebrafish");
    await ctx.engine.rebuild();
    assertEquals(tagPages(ctx), 2, "taxonomy follows before rebuild() returns");
    await eventually(async () => (await ctx.search.search("zebrafish")).length === 1, "the new page is searchable");
    ctx.search.close();
  });
});

Deno.test("without buildSearch the taxonomy still follows and search is not built behind the caller's back", opts, async () => {
  await withSite([], false, async (ctx, root) => {
    await addPage(root, "02.new", "zebrafish");
    await ctx.engine.rebuild();
    assertEquals(tagPages(ctx), 2);
    await new Promise((r) => setTimeout(r, 150));
    assertEquals(ctx.search.status().every((s) => s.state === "pending"), true);
    ctx.search.close();
  });
});

Deno.test("plugin-injected records are collected again on rebuild: a new one appears, a removed one goes", opts, async () => {
  let records: InjectedSearchRecord[] = [{ route: "/pdf/1.pdf", title: "Issue 1", body: "kangaroo" }];
  let collected = 0;
  const pdf: DunePlugin = {
    name: "fake-pdf",
    version: "1.0.0",
    hooks: {
      onSearchRecordsCollect: ({ data }) => {
        collected++;
        (data as { records: InjectedSearchRecord[] }).records.push(...records);
      },
    } as DunePlugin["hooks"],
  };
  await withSite([pdf], true, async (ctx) => {
    assertEquals((await ctx.search.search("kangaroo")).length, 1);
    assertEquals(collected, 1);

    // A second issue is added to content/pdf/ and the first is replaced.
    records = [{ route: "/pdf/2.pdf", title: "Issue 2", body: "wombat" }];
    await ctx.engine.rebuild();
    await eventually(async () => (await ctx.search.search("wombat")).length === 1, "the new record is searchable");
    assertEquals((await ctx.search.search("kangaroo")).length, 0, "the removed record's pages are gone");
    assertEquals(collected, 2);
    ctx.search.close();
  });
});

Deno.test("a burst of rebuilds costs fewer search refreshes than rebuilds", opts, async () => {
  let collected = 0;
  const counter: DunePlugin = {
    name: "counter",
    version: "1.0.0",
    hooks: {
      onSearchRecordsCollect: async () => {
        collected++;
        await new Promise((r) => setTimeout(r, 60));
      },
    } as DunePlugin["hooks"],
  };
  await withSite([counter], true, async (ctx) => {
    const boot = collected;
    // Five rebuilds queued at once: each fires onRebuild, which returns immediately
    // while one search refresh runs and at most one more is queued behind it.
    await Promise.all([1, 2, 3, 4, 5].map(() => ctx.engine.rebuild()));
    await new Promise((r) => setTimeout(r, 500));
    const refreshes = collected - boot;
    assertEquals(refreshes >= 1 && refreshes < 5, true, `expected fewer than 5 refreshes, got ${refreshes}`);
    ctx.search.close();
  });
});

Deno.test("a plugin's onRebuild hook fires after engine.rebuild() in a real bootstrap, and sees the new index", opts, async () => {
  const seen: number[] = [];
  let engineRef: { pages: unknown[] } | undefined;
  const watcher: DunePlugin = {
    name: "rebuild-watcher",
    version: "1.0.0",
    hooks: {
      onRebuild: () => {
        seen.push(engineRef!.pages.length);
      },
    } as DunePlugin["hooks"],
  };
  await withSite([watcher], false, async (ctx, root) => {
    engineRef = ctx.engine;
    assertEquals(seen, []);
    await addPage(root, "02.new", "x");
    await ctx.engine.rebuild();
    // Before this was wired the engine had no hook registry and never fired it; and the
    // handler must see the rebuilt index (2 pages), not the one it replaced.
    assertEquals(seen, [2]);
    ctx.search.close();
  });
});

Deno.test("a throwing onRebuild handler fails nothing: the rebuild resolves, the indexes refresh, later rebuilds still run", opts, async () => {
  let calls = 0;
  const bad: DunePlugin = {
    name: "bad-rebuild-handler",
    version: "1.0.0",
    hooks: {
      onRebuild: () => {
        calls++;
        throw new Error("boom");
      },
    } as DunePlugin["hooks"],
  };
  await withSite([bad], true, async (ctx, root) => {
    await addPage(root, "02.first", "zebrafish");
    await ctx.engine.rebuild(); // used to reject here, and to break every rebuild after it
    assertEquals(calls, 1);
    assertEquals(tagPages(ctx), 2, "taxonomy refreshed although the plugin's handler ran first and threw");
    await eventually(async () => (await ctx.search.search("zebrafish")).length === 1, "search refreshed too");

    await addPage(root, "03.second", "wombat");
    await ctx.engine.rebuild(); // the chain is not stuck on the earlier failure
    assertEquals(calls, 2);
    assertEquals(tagPages(ctx), 3);
    await eventually(async () => (await ctx.search.search("wombat")).length === 1, "the second page is searchable");
    ctx.search.close();
  });
});

Deno.test("a rebuild that fails rejects its own caller only; the next rebuild runs", opts, async () => {
  await withSite([], false, async (ctx, root) => {
    // The router fails once while the rebuild is installing the new index.
    const router = ctx.engine.router as unknown as { rebuild: (...a: unknown[]) => unknown };
    const original = router.rebuild.bind(router);
    let failNext = true;
    router.rebuild = (...args: unknown[]) => {
      if (failNext) {
        failNext = false;
        throw new Error("router went away");
      }
      return original(...args);
    };
    let rejected = false;
    await ctx.engine.rebuild().catch(() => {
      rejected = true;
    });
    assertEquals(rejected, true, "the failing rebuild reports its failure to its caller");

    await addPage(root, "02.later", "x");
    await ctx.engine.rebuild(); // used to be skipped for good (a rejected chain)
    assertEquals(ctx.engine.pages.length, 2);
    ctx.search.close();
  });
});
