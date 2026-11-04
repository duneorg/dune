import { assertEquals } from "@std/assert";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import { resetFormsConfigWarnings, resolveFormsConfig } from "../../src/forms/config.ts";

const fresh = () => structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;

Deno.test("forms config: defaults", () => {
  assertEquals(resolveFormsConfig(fresh()), {
    honeypot: "_hp",
    notifications: undefined,
    incomingWebhooks: [],
    dataDir: "data",
  });
});

Deno.test("forms config: new keys are read", () => {
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

Deno.test("forms config: deprecated admin.* keys still work", () => {
  resetFormsConfigWarnings();
  const c = fresh();
  c.admin!.honeypot = "old";
  c.admin!.data_dir = "olddata";
  c.admin!.incoming_webhooks = [{ token: "t", actions: ["purge-cache"] }];
  c.admin!.notifications = { webhook: { url: "https://x.example/h" } };
  const r = resolveFormsConfig(c);
  assertEquals(r.honeypot, "old");
  assertEquals(r.dataDir, "olddata");
  assertEquals(r.incomingWebhooks[0].actions, ["purge-cache"]);
  assertEquals(r.notifications?.webhook?.url, "https://x.example/h");
});

Deno.test("forms config: new keys win over deprecated ones", () => {
  const c = fresh();
  c.admin!.honeypot = "old";
  c.site.forms = { honeypot: "new" };
  c.admin!.data_dir = "olddata";
  c.system.data_dir = "newdata";
  const r = resolveFormsConfig(c);
  assertEquals(r.honeypot, "new");
  assertEquals(r.dataDir, "newdata");
});
