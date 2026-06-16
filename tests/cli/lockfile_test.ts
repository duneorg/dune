/**
 * Tests for `dune lockfile check` / `dune lockfile sync` — the additive-only
 * merge algorithm and workspace-root discovery, plus an end-to-end pass
 * through the real subprocess orchestration.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  computeLockfileSync,
  findEffectiveLockfileDir,
  mergeLockfiles,
} from "../../src/cli/lockfile.ts";

// ── mergeLockfiles (pure) ─────────────────────────────────────────────────────

Deno.test("mergeLockfiles: a genuinely new key is added", () => {
  const original = { version: "5", specifiers: { "jsr:@std/path@^1": "1.0.0" } };
  const resolved = {
    version: "5",
    specifiers: { "jsr:@std/path@^1": "1.0.0", "jsr:@std/yaml@^1": "1.0.5" },
  };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.specifiers, {
    "jsr:@std/path@^1": "1.0.0",
    "jsr:@std/yaml@^1": "1.0.5",
  });
  assertEquals(diffs.specifiers.added, ["jsr:@std/yaml@^1"]);
  assertEquals(diffs.specifiers.blocked, []);
});

Deno.test("mergeLockfiles: an already-pinned entry resolving differently is reverted, not applied", () => {
  // This is the exact ioredis scenario: same range specifier, registry now
  // serves a newer match. Must NOT silently apply.
  const original = { version: "5", specifiers: { "npm:ioredis@5": "5.10.1" } };
  const resolved = { version: "5", specifiers: { "npm:ioredis@5": "5.11.1" } };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.specifiers, { "npm:ioredis@5": "5.10.1" });
  assertEquals(diffs.specifiers.blocked, ["npm:ioredis@5"]);
  assertEquals(diffs.specifiers.added, []);
  assertEquals(diffs.specifiers.upgraded, []);
});

Deno.test("mergeLockfiles: --upgrade allows an explicit, named pin change through", () => {
  const original = { version: "5", specifiers: { "npm:ioredis@5": "5.10.1" } };
  const resolved = { version: "5", specifiers: { "npm:ioredis@5": "5.11.1" } };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set(["npm:ioredis@5"]));
  assertEquals(merged.specifiers, { "npm:ioredis@5": "5.11.1" });
  assertEquals(diffs.specifiers.upgraded, ["npm:ioredis@5"]);
  assertEquals(diffs.specifiers.blocked, []);
});

Deno.test("mergeLockfiles: identical values produce no diff entry at all", () => {
  const original = { version: "5", specifiers: { "jsr:@std/path@^1": "1.0.0" } };
  const resolved = { version: "5", specifiers: { "jsr:@std/path@^1": "1.0.0" } };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.specifiers, { "jsr:@std/path@^1": "1.0.0" });
  assertEquals(diffs.specifiers, { added: [], blocked: [], upgraded: [] });
});

Deno.test("mergeLockfiles: an orphaned entry (only in original) is kept, not pruned", () => {
  const original = { version: "5", specifiers: { "jsr:@dune/plugin-x@1.0.0": "1.0.0" } };
  const resolved = { version: "5", specifiers: {} };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.specifiers, { "jsr:@dune/plugin-x@1.0.0": "1.0.0" });
  assertEquals(diffs.specifiers.added, []);
});

Deno.test("mergeLockfiles: works the same way across jsr, npm, and remote sections", () => {
  const original = {
    version: "5",
    jsr: { "@std/path@1.0.0": { integrity: "aaa" } },
    npm: { "ioredis@5.10.1": { integrity: "bbb" } },
    remote: { "https://example.com/x.ts": "ccc" },
  };
  const resolved = {
    version: "5",
    jsr: {
      "@std/path@1.0.0": { integrity: "aaa" },
      "@std/yaml@1.0.5": { integrity: "ddd" },
    },
    npm: { "ioredis@5.10.1": { integrity: "bbb" }, "ioredis@5.11.1": { integrity: "eee" } },
    remote: { "https://example.com/x.ts": "ccc", "https://example.com/y.ts": "fff" },
  };
  const { merged, diffs } = mergeLockfiles(original, resolved, new Set());
  assertEquals(diffs.jsr.added, ["@std/yaml@1.0.5"]);
  assertEquals(diffs.npm.added, ["ioredis@5.11.1"]);
  assertEquals(diffs.remote.added, ["https://example.com/y.ts"]);
  assertEquals(merged.jsr, {
    "@std/path@1.0.0": { integrity: "aaa" },
    "@std/yaml@1.0.5": { integrity: "ddd" },
  });
});

Deno.test("mergeLockfiles: workspace is always taken wholesale from resolved", () => {
  const original = {
    version: "5",
    workspace: { members: { site: { dependencies: ["jsr:@dune/core@0.20.1"] } } },
  };
  const resolved = {
    version: "5",
    workspace: { members: { site: { dependencies: ["jsr:@dune/core@0.21.0"] } } },
  };
  const { merged } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.workspace, {
    members: { site: { dependencies: ["jsr:@dune/core@0.21.0"] } },
  });
});

Deno.test("mergeLockfiles: version is preserved from original when present", () => {
  const original = { version: "5", specifiers: {} };
  const resolved = { version: "5", specifiers: {} };
  const { merged } = mergeLockfiles(original, resolved, new Set());
  assertEquals(merged.version, "5");
});

Deno.test("mergeLockfiles: with no original lockfile, everything resolved is an addition", () => {
  const resolved = { version: "5", specifiers: { "jsr:@std/path@^1": "1.0.0" } };
  const { merged, diffs } = mergeLockfiles(null, resolved, new Set());
  assertEquals(merged.specifiers, { "jsr:@std/path@^1": "1.0.0" });
  assertEquals(diffs.specifiers.added, ["jsr:@std/path@^1"]);
});

Deno.test("mergeLockfiles: empty section is omitted from the merged result", () => {
  const original = { version: "5" };
  const resolved = { version: "5" };
  const { merged } = mergeLockfiles(original, resolved, new Set());
  assertEquals("specifiers" in merged, false);
  assertEquals("jsr" in merged, false);
});

// ── findEffectiveLockfileDir ──────────────────────────────────────────────────

Deno.test("findEffectiveLockfileDir: root itself is the workspace root", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ workspace: ["./member"] }));
  const found = await findEffectiveLockfileDir(root);
  assertEquals(found, root);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findEffectiveLockfileDir: workspace root one level up from a member", async () => {
  const root = await Deno.makeTempDir();
  const member = join(root, "site");
  await Deno.mkdir(member);
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ workspace: ["./site"] }));
  await Deno.writeTextFile(join(member, "deno.json"), JSON.stringify({ imports: {} }));
  const found = await findEffectiveLockfileDir(member);
  assertEquals(found, root);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findEffectiveLockfileDir: no workspace anywhere falls back to the given root", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ imports: {} }));
  const found = await findEffectiveLockfileDir(root);
  assertEquals(found, root);
  await Deno.remove(root, { recursive: true });
});

// ── computeLockfileSync (integration: real subprocess + real fs) ────────────

Deno.test({
  name: "computeLockfileSync: adds a missing jsr dependency pulled in by a local plugin, end-to-end",
  // Spawns real `deno run`/`deno cache` subprocesses — network-dependent
  // (resolves a real jsr package) and slower than the pure unit tests above.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      // The discovery subprocess imports dune-core's own internal modules
      // (storage/mod.ts etc.) by relative path, since this test runs
      // against local source rather than a published JSR build. Local
      // file:// paths have no embedded per-package import map the way a
      // JSR-fetched package does in production, so they share whatever
      // single --config= is active. Using dune's own deno.json imports as
      // the fixture's config keeps dune's internals resolvable; the test
      // plugin deliberately imports something (@std/path) already in that
      // map so it resolves too, sidestepping a local-source-only quirk
      // that doesn't exist when dune is consumed via JSR in real use.
      const duneOwnDenoJson = JSON.parse(
        await Deno.readTextFile(join(import.meta.dirname!, "..", "..", "deno.json")),
      );
      await Deno.writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({ imports: duneOwnDenoJson.imports }),
      );
      await Deno.mkdir(join(root, "plugins"));
      await Deno.writeTextFile(
        join(root, "plugins", "test-plugin.ts"),
        `
        import { join } from "@std/path";
        export default {
          name: "test-plugin",
          version: "1.0.0",
          hooks: {},
        };
        void join; // keep the import used
        `,
      );
      await Deno.mkdir(join(root, "config"));
      await Deno.writeTextFile(
        join(root, "config", "site.yaml"),
        `
title: Test Site
plugins:
  - src: "./plugins/test-plugin.ts"
`,
      );

      const { status, merged } = await computeLockfileSync(root, new Set());
      assertEquals(status.lockfilePath, join(root, "deno.lock"));
      // The local plugin itself isn't a registry specifier, but its import
      // of @std/path is real and must show up as an addition.
      const specifiers = (merged.specifiers as Record<string, string>) ?? {};
      assertEquals(Object.keys(specifiers).some((k) => k.includes("@std/path")), true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
