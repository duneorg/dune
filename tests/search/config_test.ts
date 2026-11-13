import { assertEquals } from "@std/assert";
import { searchOptionsFromConfig } from "../../src/search/config.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
import { flag, initFlags } from "../../src/flags/mod.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

Deno.test("searchOptionsFromConfig: unset config leaves every engine default alone", () => {
  assertEquals(searchOptionsFromConfig(undefined), {});
  assertEquals(searchOptionsFromConfig({}), {});
});

Deno.test("searchOptionsFromConfig: custom_fields, weights, highlight and excerpt_length reach the engine options", () => {
  assertEquals(
    searchOptionsFromConfig({
      custom_fields: ["summary", "author"],
      fields: { title: { weight: 5 }, body: { weight: 0.5 } },
      highlight: false,
      excerpt_length: 80,
    }),
    {
      customFields: ["summary", "author"],
      fieldWeights: { title: 5, body: 0.5 },
      highlightMatches: false,
      excerptLength: 80,
    },
  );
});

Deno.test("search config end to end: custom_fields makes a frontmatter field searchable", async () => {
  const formats = new FormatRegistry();
  formats.register({
    extensions: [".md"],
    extractFrontmatter: () => Promise.resolve({ title: "Alpha", author: "Zebulon" }),
    extractBody: () => "plain body",
    renderToHtml: () => Promise.resolve(""),
  });
  const storage = { readText: () => Promise.resolve("raw") } as unknown as StorageAdapter;
  const page = {
    route: "/a",
    sourcePath: "01.a/default.md",
    language: "en",
    format: "md",
    template: "default",
    title: "Alpha",
    navTitle: "Alpha",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    order: 1,
    depth: 0,
    parentPath: "",
    taxonomy: {},
    mtime: 0,
    hash: "h",
  } as unknown as PageIndex;
  const build = async (extra: Record<string, unknown>) => {
    const e = createSearchEngine({
      pages: [page],
      storage,
      contentDir: "content",
      formats,
      ...extra,
    });
    await e.build();
    return e;
  };
  const without = await build({});
  const configured = await build(searchOptionsFromConfig({ custom_fields: ["author"] }));
  assertEquals((await without.search("zebulon")).length, 0);
  assertEquals((await configured.search("zebulon")).length, 1);
});

Deno.test("initFlags(config.system.flags): declared flags resolve, undeclared ones are false", () => {
  Deno.env.set("DUNE_TEST_FLAG", "yes");
  try {
    initFlags({ comments: true, beta: "env:DUNE_TEST_FLAG", off: false });
    assertEquals([flag("comments"), flag("beta"), flag("off"), flag("nope")], [
      true,
      true,
      false,
      false,
    ]);
  } finally {
    Deno.env.delete("DUNE_TEST_FLAG");
    initFlags({});
  }
});

Deno.test("bootstrap() resolves system.yaml flags, so flag() works without any manual initFlags()", async () => {
  const { bootstrap } = await import("../../src/runtime/bootstrap.ts");
  const root = await Deno.makeTempDir({ prefix: "dune_test_flags_" });
  try {
    await Deno.mkdir(`${root}/config`, { recursive: true });
    await Deno.mkdir(`${root}/content/01.home`, { recursive: true });
    await Deno.writeTextFile(`${root}/config/site.yaml`, "title: Flags\n");
    await Deno.writeTextFile(
      `${root}/config/system.yaml`,
      "flags:\n  comments: true\n  beta: false\n",
    );
    await Deno.writeTextFile(`${root}/content/01.home/default.md`, "---\ntitle: Home\n---\nhi\n");
    await bootstrap(root);
    assertEquals([flag("comments"), flag("beta"), flag("undeclared")], [true, false, false]);
  } finally {
    initFlags({});
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
