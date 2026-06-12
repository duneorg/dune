import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  isRemoteIslandSpec,
  materializeRemoteIslands,
} from "../../src/cli/remote-islands.ts";

Deno.test("isRemoteIslandSpec: classifies specifiers", () => {
  assert(isRemoteIslandSpec("https://jsr.io/@dune/core/0.18.1/src/admin/islands/X.tsx"));
  assert(isRemoteIslandSpec("jsr:@some/plugin/islands/Y.tsx"));
  assert(isRemoteIslandSpec("npm:some-pkg/island.js"));
  assert(!isRemoteIslandSpec("/abs/path/islands/X.tsx"));
  assert(!isRemoteIslandSpec("./relative/island.tsx"));
});

Deno.test("materializeRemoteIslands: local paths pass through untouched", async () => {
  const root = await Deno.makeTempDir();
  try {
    const specs = ["/abs/islands/A.tsx", "/abs/islands/B.tsx"];
    const out = await materializeRemoteIslands(specs, root);
    assertEquals(out, specs);
    // No wrapper dir created when nothing is remote.
    const exists = await Deno.stat(join(root, ".dune", "remote-islands"))
      .then(() => true, () => false);
    assertEquals(exists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("materializeRemoteIslands: remote specs become local wrappers", async () => {
  const root = await Deno.makeTempDir();
  try {
    const url = "https://jsr.io/@dune/core/0.18.1/src/admin/islands/ConfigEditor.tsx";
    const [wrapper] = await materializeRemoteIslands([url], root);
    assert(wrapper.startsWith(join(root, ".dune", "remote-islands")));
    assert(wrapper.endsWith("ConfigEditor.ts"));
    const code = await Deno.readTextFile(wrapper);
    assert(code.includes(`import * as $mod from ${JSON.stringify(url)};`));
    assert(code.includes(`export * from ${JSON.stringify(url)};`));
    assert(code.includes("export default ($mod as any).default;"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("materializeRemoteIslands: name collisions get unique files, order preserved", async () => {
  const root = await Deno.makeTempDir();
  try {
    const specs = [
      "https://example.com/a/Island.tsx",
      "/local/path/Keep.tsx",
      "https://example.com/b/Island.tsx",
    ];
    const out = await materializeRemoteIslands(specs, root);
    assertEquals(out.length, 3);
    assertEquals(out[1], "/local/path/Keep.tsx");
    assert(out[0].endsWith("Island.ts"));
    assert(out[2].endsWith("Island_1.ts"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("materializeRemoteIslands: stale wrappers are removed on reuse", async () => {
  const root = await Deno.makeTempDir();
  try {
    await materializeRemoteIslands(["https://example.com/Old.tsx"], root);
    const out = await materializeRemoteIslands(["https://example.com/New.tsx"], root);
    const dir = join(root, ".dune", "remote-islands");
    const files = [...Deno.readDirSync(dir)].map((e) => e.name).sort();
    assertEquals(files, ["New.ts"]);
    assert(out[0].endsWith("New.ts"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
