/**
 * Tests for plugin client-entry bundling (DunePlugin.clientEntries).
 */

import { assertEquals, assertNotEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { buildPluginClientBundles, serveClientBundle } from "../../src/cli/client-bundles.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function makeEntry(dir: string, code: string): Promise<string> {
  const file = join(dir, "entry.ts");
  await Deno.writeTextFile(file, code);
  return `file://${file}`;
}

function makePlugin(specifier: string, version = "1.0.0"): DunePlugin {
  return {
    name: "test-plugin",
    version,
    hooks: {},
    clientEntries: { widget: specifier },
  };
}

Deno.test("buildPluginClientBundles: bundles an entry and serves it", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export function hello(): string { return "from-bundle"; }`);
  const bundles = await buildPluginClientBundles([makePlugin(spec)], { root, dev: false });

  assertEquals([...bundles.keys()], ["test-plugin/widget.js"]);

  const req = new Request("http://localhost/plugins/test-plugin/widget.js");
  const res = serveClientBundle(bundles, "/plugins/test-plugin/widget.js", req, false);
  assertEquals(res?.status, 200);
  assertEquals(res?.headers.get("Content-Type"), "text/javascript; charset=utf-8");
  assertStringIncludes(await res!.text(), "from-bundle");
});

Deno.test("buildPluginClientBundles: production cache is reused by version", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const v = 1;`);
  const first = await buildPluginClientBundles([makePlugin(spec)], { root, dev: false });

  // Change the source without bumping the version — cached bundle wins.
  await makeEntry(root, `export const v = 2;`);
  const second = await buildPluginClientBundles([makePlugin(spec)], { root, dev: false });
  assertEquals(
    new TextDecoder().decode(second.get("test-plugin/widget.js")!.code),
    new TextDecoder().decode(first.get("test-plugin/widget.js")!.code),
  );

  // Bumping the version rebuilds.
  const bumped = await buildPluginClientBundles([makePlugin(spec, "1.0.1")], { root, dev: false });
  assertStringIncludes(
    new TextDecoder().decode(bumped.get("test-plugin/widget.js")!.code),
    "2",
  );
});

Deno.test("buildPluginClientBundles: dev mode rebuilds every time", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const v = "first";`);
  await buildPluginClientBundles([makePlugin(spec)], { root, dev: true });

  await makeEntry(root, `export const v = "second";`);
  const rebuilt = await buildPluginClientBundles([makePlugin(spec)], { root, dev: true });
  assertStringIncludes(
    new TextDecoder().decode(rebuilt.get("test-plugin/widget.js")!.code),
    "second",
  );
});

Deno.test("buildPluginClientBundles: failing entry is skipped, others build", async () => {
  const root = await Deno.makeTempDir();
  const good = await makeEntry(root, `export const ok = true;`);
  const plugin: DunePlugin = {
    name: "mixed",
    version: "1.0.0",
    hooks: {},
    clientEntries: {
      good,
      broken: `file://${join(root, "does-not-exist.ts")}`,
    },
  };
  const bundles = await buildPluginClientBundles([plugin], { root, dev: false });
  assertEquals(bundles.has("mixed/good.js"), true);
  assertEquals(bundles.has("mixed/broken.js"), false);
});

Deno.test("buildPluginClientBundles: ETag tracks content, not identity (F2)", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const v = "first";`);
  const first = await buildPluginClientBundles([makePlugin(spec)], { root, dev: true });
  const firstEtag = first.get("test-plugin/widget.js")!.etag;

  // Same content → same ETag.
  const same = await buildPluginClientBundles([makePlugin(spec)], { root, dev: true });
  assertEquals(same.get("test-plugin/widget.js")!.etag, firstEtag);

  // Dev rebuild with changed content, same plugin version → ETag changes,
  // so a browser revalidating against the old ETag gets 200, not 304.
  await makeEntry(root, `export const v = "second";`);
  const rebuilt = await buildPluginClientBundles([makePlugin(spec)], { root, dev: true });
  const newEtag = rebuilt.get("test-plugin/widget.js")!.etag;
  assertNotEquals(newEtag, firstEtag);

  const req = new Request("http://localhost/plugins/test-plugin/widget.js", {
    headers: { "if-none-match": firstEtag },
  });
  const res = serveClientBundle(rebuilt, "/plugins/test-plugin/widget.js", req, true);
  assertEquals(res?.status, 200);
});

Deno.test("serveClientBundle: ETag revalidation returns 304", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const x = 1;`);
  const bundles = await buildPluginClientBundles([makePlugin(spec)], { root, dev: false });
  const etag = bundles.get("test-plugin/widget.js")!.etag;

  const req = new Request("http://localhost/plugins/test-plugin/widget.js", {
    headers: { "if-none-match": etag },
  });
  const res = serveClientBundle(bundles, "/plugins/test-plugin/widget.js", req, false);
  assertEquals(res?.status, 304);
});

Deno.test("serveClientBundle: unknown paths fall through as null", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const x = 1;`);
  const bundles = await buildPluginClientBundles([makePlugin(spec)], { root, dev: false });
  const req = new Request("http://localhost/x");
  assertEquals(serveClientBundle(bundles, "/plugins/test-plugin/other.js", req, false), null);
  assertEquals(serveClientBundle(bundles, "/static/widget.js", req, false), null);
});

Deno.test("buildPluginClientBundles: ambiguous identity triples get distinct cache files (F3)", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "a"));
  await Deno.mkdir(join(root, "b"));
  const specA = await makeEntry(join(root, "a"), `export const which = "plugin-a";`);
  const specB = await makeEntry(join(root, "b"), `export const which = "plugin-b";`);

  // Both triples flatten to the same "name-version-entry" string.
  const a: DunePlugin = {
    name: "foo",
    version: "1.0.0-beta",
    hooks: {},
    clientEntries: { x: specA },
  };
  const b: DunePlugin = {
    name: "foo-1.0.0",
    version: "beta",
    hooks: {},
    clientEntries: { x: specB },
  };

  await buildPluginClientBundles([a], { root, dev: false });
  // Second build must NOT reuse plugin a's cached bundle for plugin b.
  const second = await buildPluginClientBundles([b], { root, dev: false });
  assertStringIncludes(
    new TextDecoder().decode(second.get("foo-1.0.0/x.js")!.code),
    "plugin-b",
  );
});

Deno.test("buildPluginClientBundles: superseded versions are pruned from the cache (F4)", async () => {
  const root = await Deno.makeTempDir();
  const spec = await makeEntry(root, `export const v = 1;`);
  const cacheDir = join(root, ".dune", "client-bundles");

  await buildPluginClientBundles([makePlugin(spec, "1.0.0")], { root, dev: false });
  await buildPluginClientBundles([makePlugin(spec, "1.0.1")], { root, dev: false });

  const files: string[] = [];
  for await (const f of Deno.readDir(cacheDir)) files.push(f.name);
  assertEquals(files.length, 1);
  assertStringIncludes(files[0], "1.0.1");
});

Deno.test("buildPluginClientBundles: no entries — empty map, no cache dir", async () => {
  const root = await Deno.makeTempDir();
  const plugin: DunePlugin = { name: "plain", version: "1.0.0", hooks: {} };
  const bundles = await buildPluginClientBundles([plugin], { root, dev: false });
  assertEquals(bundles.size, 0);
  let exists = true;
  try {
    await Deno.stat(join(root, ".dune", "client-bundles"));
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
});
