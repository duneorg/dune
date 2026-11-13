/**
 * `mountPlugins()` writes the capability report `dune doctor --boot` reads, on
 * a real bootstrap, when (and only when) a doctor run asked for it.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import { DOCTOR_REPORT_ENV, type DoctorReport } from "../../src/plugin-api/doctor-report.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

Deno.test(
  "mountPlugins: writes who provides what, including a provider that threw",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_report_" });
    const reportPath = join(root, "report.json");
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );

      const good: DunePlugin = {
        name: "good-admin",
        version: "1.0.0",
        hooks: {},
        setup(api) {
          api.capabilities.provide(
            "editor.session",
            () => ({ authenticate: () => Promise.resolve({ authenticated: false }) }),
          );
        },
      };
      const broken: DunePlugin = {
        name: "broken-executor",
        version: "1.0.0",
        hooks: {},
        setup(api) {
          api.capabilities.provide("scheduler.executor", () => {
            throw new Error("no database");
          });
        },
      };

      const ctx = await bootstrap(root, { plugins: [good, broken] });
      Deno.env.set(DOCTOR_REPORT_ENV, reportPath);
      // deno-lint-ignore no-explicit-any
      await mountPlugins(new App<any>(), ctx);

      const report = JSON.parse(await Deno.readTextFile(reportPath)) as DoctorReport;
      const bySlot = Object.fromEntries(
        report.providers.map((p) => [p.name, `${p.provider}:${p.status}`]),
      );
      assertEquals(bySlot["editor.session"], "good-admin:active");
      assertEquals(bySlot["scheduler.executor"], "broken-executor:failed");
      assertEquals(report.scheduledActions, 0);
    } finally {
      Deno.env.delete(DOCTOR_REPORT_ENV);
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
