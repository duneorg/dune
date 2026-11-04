import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import { createPluginServices, isDuneError } from "../../src/plugin-api/mod.ts";
import { BodyTooLargeError } from "../../src/security/body-limit.ts";
import { SsrfBlockedError } from "../../src/security/ssrf.ts";
import { DuplicateEmailError } from "../../src/auth/user-store.ts";
import { WeakPasswordError } from "../../src/auth/passwords.ts";

const config = () => structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
const services = () => createPluginServices({ config: config(), storage: new MemoryStorageAdapter() });

Deno.test("errors carry a stable code and isDuneError matches on it", () => {
  assertEquals(isDuneError(new BodyTooLargeError(10), "body_too_large"), true);
  assertEquals(isDuneError(new SsrfBlockedError("x"), "ssrf_blocked"), true);
  assertEquals(isDuneError(new DuplicateEmailError("a@b.c"), "duplicate_email"), true);
  assertEquals(isDuneError(new WeakPasswordError("short"), "weak_password"), true);
  assertEquals(isDuneError(new BodyTooLargeError(10), "ssrf_blocked"), false);
  assertEquals(isDuneError(new Error("x"), "body_too_large"), false);
  assertEquals(isDuneError(null, "body_too_large"), false);
  // identity by code, not by class: a look-alike from another module copy still matches
  assertEquals(isDuneError({ code: "ssrf_blocked" }, "ssrf_blocked"), true);
});

Deno.test("security service: sanitising, password policy, body limits", () => {
  const { security } = services();
  assertEquals(security.sanitizeHtml('<p>hi</p><script>alert(1)</script>').includes("script"), false);
  assertEquals(security.checkPasswordStrength("short").ok, false);
  assertEquals(security.checkPasswordStrength("a-long-enough-passphrase").ok, true);
  const big = new Request("http://x/", { method: "POST", headers: { "content-length": "100" }, body: "x".repeat(100) });
  assertEquals(security.checkBodySize(big, 10)?.status, 413);
  assertEquals(security.parseUserYaml("a: 1"), { a: 1 });
});

Deno.test("password service round-trips and verifies the dummy hash without matching", async () => {
  const { passwords } = services();
  const hash = await passwords.hash("a-long-enough-passphrase");
  assertEquals(await passwords.verify("a-long-enough-passphrase", hash), true);
  assertEquals(await passwords.verify("wrong", hash), false);
  assertEquals(passwords.needsRehash(hash), false);
  assertEquals(await passwords.verify("anything", passwords.dummyHash), false);
});

Deno.test("rate limit service: a limiter blocks after its budget", () => {
  const { rateLimit } = services();
  const limiter = rateLimit.createLimiter(2, 60_000);
  assertEquals(limiter.check("1.2.3.4"), true);
  assertEquals(limiter.check("1.2.3.4"), true);
  assertEquals(limiter.check("1.2.3.4"), false);
  assertExists(rateLimit.createLocalStore());
});

Deno.test("session service: a manager over the configured (local) backend creates, reads and revokes", async () => {
  const { sessions } = services();
  const mgr = await sessions.createManager({ sessionsDir: ".dune/admin/sessions", lifetimeMs: 60_000 });
  const s = await mgr.create("user-1", "1.2.3.4");
  assertEquals((await mgr.get(s.id))?.userId, "user-1");
  await mgr.revokeAll("user-1");
  assertEquals(await mgr.get(s.id), null);
});

Deno.test("user service: local store creates users and reports duplicates by code", async () => {
  const { users } = services();
  const store = users.createLocalStore({ usersDir: "data/users" });
  await store.create({ email: "a@b.c", username: "a", provider: "local", roles: ["admin"], passwordHash: "x" });
  const err = await assertRejects(() =>
    store.create({ email: "a@b.c", username: "b", provider: "local", roles: [], passwordHash: "x" })
  );
  assertEquals(isDuneError(err, "duplicate_email"), true);
});

Deno.test("the hook registry hands plugins the services in setup()", () => {
  const cfg = config();
  const storage = new MemoryStorageAdapter();
  const provided = createPluginServices({ config: cfg, storage });
  let seen: unknown;
  const hooks = createHookRegistry({ config: cfg, storage, services: provided });
  hooks.registerPlugin({ name: "p", version: "1", hooks: {}, setup: (api) => void (seen = api.services) });
  assertEquals(seen === provided, true);

  // without an explicit services option the registry builds its own
  let seen2: unknown;
  createHookRegistry({ config: cfg, storage }).registerPlugin({
    name: "q",
    version: "1",
    hooks: {},
    setup: (api) => void (seen2 = api.services),
  });
  assertExists((seen2 as { security?: unknown }).security);
});

Deno.test("engines: workflow, scheduler and staging are built; no mt unless configured", () => {
  const { engines } = services();
  assertExists(engines.workflow);
  assertExists(engines.scheduler);
  assertExists(engines.staging);
  assertEquals(engines.mt, null);
  assertEquals(engines.audit, null, "no site root, no audit trail");
});

Deno.test("engines: the audit trail logs without an explicit init and honours enabled:false", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { engines } = createPluginServices({ config: config(), storage: new MemoryStorageAdapter(), root });
    assertExists(engines.audit);
    await engines.audit!.log({ event: "page.update", actor: null, ip: null, userAgent: null, target: null, detail: {} } as never);
    const res = await engines.audit!.query({ event: "page.update" });
    assertEquals(res.entries.length, 1);

    const off = config();
    off.admin = { ...off.admin, audit: { enabled: false } } as never;
    assertEquals(createPluginServices({ config: off, storage: new MemoryStorageAdapter(), root }).engines.audit, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("engines: an audit log_file outside the site root is refused", () => {
  const cfg = config();
  cfg.admin = { ...cfg.admin, audit: { log_file: "../elsewhere/audit.log" } } as never;
  try {
    createPluginServices({ config: cfg, storage: new MemoryStorageAdapter(), root: "/srv/site" });
    throw new Error("expected a throw");
  } catch (err) {
    assertEquals((err as Error).message.includes("must resolve under the site root"), true);
  }
});

Deno.test("authz service: seedAdminTuples is a no-op without an authz system", async () => {
  await services().authz.seedAdminTuples([{ id: "u1", role: "admin" }]);
});

Deno.test("blueprints service: has/resolve/validate follow the loaded blueprints, extends included", () => {
  const blueprints = {
    base: { title: "Base", fields: { title: { type: "text", required: true } } },
    post: { title: "Post", extends: "base", fields: { author: { type: "text" } } },
  };
  const { blueprints: bp } = createPluginServices({
    config: config(),
    storage: new MemoryStorageAdapter(),
    getBlueprints: () => blueprints as never,
  });
  assertEquals(bp.has("post"), true);
  assertEquals(bp.has("nope"), false);
  assertEquals(bp.resolve("nope"), null);
  assertEquals(Object.keys(bp.resolve("post")!.fields).sort(), ["author", "title"]);
  assertEquals(bp.validate({} as never, "nope"), []);
  assertEquals(bp.validate({} as never, "post").length > 0, true, "missing required inherited field");
  assertEquals(bp.validate({ title: "x" } as never, "post"), []);
});

Deno.test("paths service: data dir and runtime dir default, and follow config", () => {
  assertEquals(services().paths, { dataDir: "data", runtimeDir: ".dune/admin" });
  const cfg = config();
  cfg.system = { ...cfg.system, data_dir: "var/data" } as never;
  cfg.admin = { ...cfg.admin, runtime_dir: ".state" } as never;
  assertEquals(createPluginServices({ config: cfg, storage: new MemoryStorageAdapter() }).paths, {
    dataDir: "var/data",
    runtimeDir: ".state",
  });
});
