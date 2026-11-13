/** Where a config hands out admin-tier roles by itself: named, never refused. */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { automaticAdminTierGrants } from "../../src/auth/automatic-grants.ts";
import { capabilityFindings } from "../../src/cli/doctor.ts";
import type { DuneConfig } from "../../src/config/types.ts";

const cfg = (site: Record<string, unknown>) => ({ site } as unknown as DuneConfig);

Deno.test("a site with no payments and no external login names nothing", () => {
  assertEquals(automaticAdminTierGrants(cfg({})), []);
  assertEquals(automaticAdminTierGrants(cfg({ auth: { mode: "dune" } })), []);
});

Deno.test("a payment product that grants a content tier is not mentioned; one that grants an admin-tier role is", () => {
  const payments = (role: string) => ({
    secret_key: "sk",
    products: [{ id: "pro", name: "Pro", priceId: "p", role }],
  });
  assertEquals(automaticAdminTierGrants(cfg({ payments: payments("member") })), []);
  const author = automaticAdminTierGrants(cfg({ payments: payments("author") }));
  assertEquals(author.length, 1);
  assertEquals(author[0].severity, "info");
  assertStringIncludes(author[0].message, 'product "pro"');
  assertStringIncludes(author[0].message, "pages they created");
  assertEquals(automaticAdminTierGrants(cfg({ payments: payments("editor") }))[0].severity, "info");
  assertEquals(
    automaticAdminTierGrants(cfg({ payments: payments("admin") }))[0].severity,
    "warning",
  );
});

Deno.test("products without a configured provider key grant nothing yet", () => {
  assertEquals(
    automaticAdminTierGrants(
      cfg({ payments: { products: [{ id: "p", name: "P", priceId: "x", role: "admin" }] } }),
    ),
    [],
  );
});

Deno.test("an external-jwt login names its roles claim", () => {
  const [g] = automaticAdminTierGrants(
    cfg({ auth: { mode: "external-jwt", jwt: { roles_claim: "groups" } } }),
  );
  assertEquals(g.severity, "info");
  assertStringIncludes(g.message, '"groups"');
});

Deno.test("doctor lists them as access findings that never fail the run", () => {
  const findings = capabilityFindings({
    providers: [],
    scheduledActions: 0,
    automaticGrants: [{ severity: "warning", message: "x" }, { severity: "info", message: "y" }],
  });
  const access = findings.filter((f) => f.category === "access");
  assertEquals(access.map((f) => f.severity), ["warning", "info"]);
  assertEquals(access.some((f) => f.severity === "error"), false);
});

Deno.test("the notes follow system.role_grants: a remapped group is named, an unmapped one is not", () => {
  const payments = (role: string) => ({
    secret_key: "sk",
    products: [{ id: "pro", name: "Pro", priceId: "p", role }],
  });
  const withGrants = (role: string, role_grants: Record<string, string>) =>
    ({ site: { payments: payments(role) }, system: { role_grants } }) as unknown as DuneConfig;

  // "staff" is not a default name, but it is mapped to editor here.
  const [staff] = automaticAdminTierGrants(withGrants("staff", { staff: "editor" }));
  assertStringIncludes(staff.message, 'mapped by system.role_grants to "editor"');
  // "editor" is no longer mapped: a payment giving it grants nothing site-wide.
  assertEquals(automaticAdminTierGrants(withGrants("editor", { staff: "editor" })), []);
  // {} turns it all off, including the external-jwt note.
  assertEquals(automaticAdminTierGrants(withGrants("editor", {})), []);
  assertEquals(
    automaticAdminTierGrants(
      {
        site: { auth: { mode: "external-jwt" } },
        system: { role_grants: {} },
      } as unknown as DuneConfig,
    ),
    [],
  );
});
