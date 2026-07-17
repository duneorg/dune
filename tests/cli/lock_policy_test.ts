/**
 * Tests for lock-policy.ts — the Deno-level lockfile policy rendered into
 * both re-exec children's args (see the module doc for the decision table,
 * and claudedocs/plan-reexec-fidelity.md for the design).
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  computeLockPolicy,
  findEffectiveLockfileDir,
  type LockPolicy,
  lockPolicyToArgs,
  preflightLockPolicy,
} from "../../src/cli/lock-policy.ts";

/** Env stub: computeLockPolicy only calls .get("DUNE_FROZEN"). */
function env(vars: Record<string, string> = {}) {
  return { get: (key: string) => vars[key] };
}

/** A standalone site dir (no enclosing workspace) to use as --root. */
async function makeSite(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({ imports: {} }));
  return await Deno.realPath(dir);
}

// ── computeLockPolicy: decision table ─────────────────────────────────────────

Deno.test("computeLockPolicy: serve defaults to none (frozen is opt-in, not the default)", async () => {
  // Frozen-by-default for serve briefly shipped (0.29.0) and was reverted:
  // Deno's --frozen validation refuses to boot against a lockfile containing
  // entries only reachable through the built-in admin plugin's variable
  // dynamic import (see this module's doc). Until that's root-caused, no
  // command defaults to frozen.
  const site = await makeSite();
  assertEquals(await computeLockPolicy(["serve", "--root", site], env()), { mode: "none" });
});

Deno.test("computeLockPolicy: dev defaults to none", async () => {
  const site = await makeSite();
  assertEquals(await computeLockPolicy(["dev", "--root", site], env()), { mode: "none" });
});

Deno.test("computeLockPolicy: other commands default to none", async () => {
  const site = await makeSite();
  assertEquals(await computeLockPolicy(["build", "--root", site], env()), { mode: "none" });
});

Deno.test("computeLockPolicy: serve --frozen opts in", async () => {
  const site = await makeSite();
  const policy = await computeLockPolicy(["serve", "--root", site, "--frozen"], env());
  assertEquals(policy, { mode: "frozen", lockPath: `${site}/deno.lock` });
});

Deno.test("computeLockPolicy: --no-frozen is a no-op against the none default", async () => {
  const site = await makeSite();
  assertEquals(
    await computeLockPolicy(["serve", "--root", site, "--no-frozen"], env()),
    { mode: "none" },
  );
});

Deno.test("computeLockPolicy: DUNE_FROZEN=1 opts any command in", async () => {
  const site = await makeSite();
  for (const command of ["serve", "dev", "build"]) {
    const policy = await computeLockPolicy([command, "--root", site], env({ DUNE_FROZEN: "1" }));
    assertEquals(policy.mode, "frozen");
  }
});

Deno.test("computeLockPolicy: DUNE_FROZEN=0 is a no-op against the none default", async () => {
  const site = await makeSite();
  assertEquals(
    await computeLockPolicy(["serve", "--root", site], env({ DUNE_FROZEN: "0" })),
    { mode: "none" },
  );
});

Deno.test("computeLockPolicy: explicit flag beats DUNE_FROZEN", async () => {
  const site = await makeSite();
  assertEquals(
    (await computeLockPolicy(["serve", "--root", site, "--frozen"], env({ DUNE_FROZEN: "0" }))).mode,
    "frozen",
  );
  assertEquals(
    await computeLockPolicy(["serve", "--root", site, "--no-frozen"], env({ DUNE_FROZEN: "1" })),
    { mode: "none" },
  );
});

Deno.test("computeLockPolicy: lockfile commands are always none", async () => {
  const site = await makeSite();
  for (const command of ["lockfile:check", "lockfile:sync"]) {
    assertEquals(
      await computeLockPolicy([command, "--root", site, "--frozen"], env({ DUNE_FROZEN: "1" })),
      { mode: "none" },
    );
  }
});

Deno.test("computeLockPolicy: --root=value form is honored", async () => {
  const site = await makeSite();
  const policy = await computeLockPolicy(["serve", `--root=${site}`, "--frozen"], env());
  assertEquals(policy, { mode: "frozen", lockPath: `${site}/deno.lock` });
});

// ── findEffectiveLockfileDir ──────────────────────────────────────────────────

Deno.test("findEffectiveLockfileDir: standalone site is its own lockfile dir", async () => {
  const site = await makeSite();
  assertEquals(await findEffectiveLockfileDir(site), site);
});

Deno.test("findEffectiveLockfileDir: nearest workspace ancestor wins", async () => {
  const root = await Deno.makeTempDir();
  const site = join(root, "sites", "demo");
  await Deno.mkdir(site, { recursive: true });
  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({ workspace: ["./sites/demo"] }),
  );
  await Deno.writeTextFile(join(site, "deno.json"), JSON.stringify({ imports: {} }));
  assertEquals(await findEffectiveLockfileDir(site), await Deno.realPath(root));
});

Deno.test("findEffectiveLockfileDir: nonexistent root is returned as-is", async () => {
  assertEquals(await findEffectiveLockfileDir("/nonexistent/dune-site"), "/nonexistent/dune-site");
});

// ── lockPolicyToArgs ──────────────────────────────────────────────────────────

Deno.test("lockPolicyToArgs: frozen renders --lock and --frozen", () => {
  const policy: LockPolicy = { mode: "frozen", lockPath: "/site/deno.lock" };
  assertEquals(lockPolicyToArgs(policy), ["--lock=/site/deno.lock", "--frozen"]);
});

Deno.test("lockPolicyToArgs: none renders --no-lock", () => {
  assertEquals(lockPolicyToArgs({ mode: "none" }), ["--no-lock"]);
});

// ── preflightLockPolicy ───────────────────────────────────────────────────────

Deno.test("preflightLockPolicy: null for mode none", async () => {
  assertEquals(await preflightLockPolicy({ mode: "none" }), null);
});

Deno.test("preflightLockPolicy: null when the lockfile exists", async () => {
  const site = await makeSite();
  const lockPath = join(site, "deno.lock");
  await Deno.writeTextFile(lockPath, JSON.stringify({ version: "5" }));
  assertEquals(await preflightLockPolicy({ mode: "frozen", lockPath }), null);
});

Deno.test("preflightLockPolicy: actionable message when the lockfile is missing", async () => {
  const site = await makeSite();
  const lockPath = join(site, "deno.lock");
  const message = await preflightLockPolicy({ mode: "frozen", lockPath });
  assertStringIncludes(message ?? "", lockPath);
  assertStringIncludes(message ?? "", "dune lockfile sync");
  assertStringIncludes(message ?? "", "--no-frozen");
});
