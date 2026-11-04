import { assertEquals } from "@std/assert";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import { resolveDataDir, resolveFormsConfig } from "../../src/forms/config.ts";

const fresh = () => structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;

Deno.test("forms config: defaults", () => {
  assertEquals(resolveFormsConfig(fresh()), {
    honeypot: "_hp",
    notifications: undefined,
    incomingWebhooks: [],
    dataDir: "data",
  });
});

Deno.test("forms config: keys are read from site.forms, system.webhooks and system.data_dir", () => {
  const c = fresh();
  c.site.forms = { honeypot: "hp2", notifications: { email: { to: "a@b.c" } } };
  c.system.data_dir = "records";
  c.system.webhooks = { incoming: [{ token: "t", actions: ["rebuild"] }] };
  const r = resolveFormsConfig(c);
  assertEquals(r.honeypot, "hp2");
  assertEquals(r.notifications?.email?.to, "a@b.c");
  assertEquals(r.dataDir, "records");
  assertEquals(r.incomingWebhooks.length, 1);
});

Deno.test("data dir: system.data_dir, default data", () => {
  const c = fresh();
  assertEquals(resolveDataDir(c), "data");
  c.system.data_dir = "var";
  assertEquals(resolveDataDir(c), "var");
});
