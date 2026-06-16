/**
 * Tests for `dune lockfile check` / `dune lockfile sync` — the additive-only
 * merge algorithm and workspace-root discovery, plus an end-to-end pass
 * through the real subprocess orchestration.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  computeLockfileSync,
  findEffectiveLockfileDir,
  lockfileCheckCommand,
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
      // computeLockfileSync never throws on its own — callers (check/sync)
      // decide what to do with status.consistent. The happy path here
      // must actually be consistent, not just "didn't throw".
      assertEquals(status.consistent, true);
      // The local plugin itself isn't a registry specifier, but its import
      // of @std/path is real and must show up as an addition.
      const specifiers = (merged.specifiers as Record<string, string>) ?? {};
      assertEquals(Object.keys(specifiers).some((k) => k.includes("@std/path")), true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "computeLockfileSync: diffs against whatever is actually on disk as 'original'",
  // The lockfile commands used to prefer a git-committed copy over disk,
  // worrying that the outer `deno run jsr:@dune/core@X/cli ...` invocation
  // would taint disk before this tool's own code ran. The actual source of
  // that taint was `cli-impl.ts`'s auto re-exec resolving its own module
  // graph against the site's real deno.lock, unfrozen — fixed by excluding
  // lockfile:check/lockfile:sync from that re-exec. With that fixed, disk
  // is never touched before computeLockfileSync runs, so it's the correct
  // and only source of "original" — no git involved.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      const duneOwnDenoJson = JSON.parse(
        await Deno.readTextFile(join(import.meta.dirname!, "..", "..", "deno.json")),
      );
      await Deno.writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({ imports: duneOwnDenoJson.imports }),
      );
      await Deno.mkdir(join(root, "config"));
      await Deno.writeTextFile(join(root, "config", "site.yaml"), `title: Test Site\n`);

      const pinnedKey = "jsr:@std/path@^1.1.4";
      await Deno.writeTextFile(
        join(root, "deno.lock"),
        JSON.stringify({ version: "5", specifiers: { [pinnedKey]: "9.9.9-pinned-on-disk" } }),
      );

      const { status, merged } = await computeLockfileSync(root, new Set());

      // The real resolved value differs from the fake pin, so it's blocked
      // either way — what matters is which value it's blocked *against*:
      // the disk value, read as "original".
      const blocked = status.diffs.specifiers?.blocked ?? [];
      assertEquals(blocked.includes(pinnedKey), true);
      const specifiers = merged.specifiers as Record<string, string>;
      assertEquals(specifiers[pinnedKey], "9.9.9-pinned-on-disk");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

// NOTE: a planned regression test here ("refuses to write a merge that
// additive-only reverting would leave internally inconsistent") was
// dropped. The real failure mode is documented and was verified by hand —
// adding @std/assert to this repo's own deno.json required disambiguating
// other packages' bare "jsr:@std/internal" references once a second,
// different @std/internal range existed, and hand-editing the lockfile
// without that disambiguation was correctly rejected by `deno test
// --frozen` (see commit history around the dune-inline-edit-prompted
// lockfile-sync work). But constructing an equivalent *synthetic* repro
// proved unexpectedly hard: Deno appears to normalize some semver range
// strings (e.g. a caret-on-bare-major like "^1" and bare "1") to the same
// canonical lookup key internally, so corrupting a hand-written specifiers
// entry didn't reliably reproduce the dangling-reference failure the real
// case hit — the corrupted key just went unconsulted. Rather than ship a
// test asserting something that isn't actually true of the mechanism,
// this is left as a documented manual-verification gap.

Deno.test({
  name: "lockfileCheckCommand: never touches the disk lockfile",
  // Reproduces a real incident: an earlier version restored the disk file
  // to its git-committed state after every check, to avoid leaving a
  // surprise dirty working tree from the outer process's own load. That's
  // indistinguishable from "an uncommitted sync result sitting on disk" —
  // running check right after sync (before committing) silently destroyed
  // the sync. check must never write the lockfile at all. Calls
  // Deno.exit(), so it's run in a subprocess; the parent verifies the file
  // is untouched afterward.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    try {
      // Superset of dune's own imports, same as the earlier end-to-end
      // test: the discovery subprocess needs dune's own internals (e.g.
      // @std/path) resolvable, since this runs against local source.
      const duneOwnDenoJson = JSON.parse(
        await Deno.readTextFile(join(import.meta.dirname!, "..", "..", "deno.json")),
      );
      await Deno.writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({ imports: duneOwnDenoJson.imports }),
      );
      await Deno.mkdir(join(root, "config"));
      await Deno.writeTextFile(join(root, "config", "site.yaml"), `title: Test Site\n`);

      // An arbitrary lockfile sitting on disk, with nothing wrong about it —
      // e.g. the result of a prior, uncommitted sync.
      const uncommittedSyncResult = JSON.stringify({
        version: "5",
        specifiers: { "npm:left-alone@1": "1.2.3-from-an-uncommitted-sync" },
      });
      await Deno.writeTextFile(join(root, "deno.lock"), uncommittedSyncResult);

      const script = `
        import { lockfileCheckCommand } from "${
        new URL("../../src/cli/lockfile.ts", import.meta.url).href
      }";
        await lockfileCheckCommand(${JSON.stringify(root)}, { json: true });
      `;
      const scriptPath = join(root, "_run_check.ts");
      await Deno.writeTextFile(scriptPath, script);
      // --config points at dune's own deno.json so this subprocess's import
      // of lockfile.ts (which needs @std/path) resolves; computeLockfileSync
      // separately uses root's own deno.json for the site-discovery step.
      const duneDenoJson = join(import.meta.dirname!, "..", "..", "deno.json");
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-check", `--config=${duneDenoJson}`, scriptPath],
        stdout: "null",
        stderr: "null",
      });
      await cmd.output(); // exit code reflects "needs sync" — irrelevant here

      const afterCheck = await Deno.readTextFile(join(root, "deno.lock"));
      assertEquals(afterCheck, uncommittedSyncResult);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
