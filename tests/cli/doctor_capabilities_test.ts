import { assertEquals, assertStringIncludes } from "@std/assert";
import { capabilityFindings } from "../../src/cli/doctor.ts";
import { DOCTOR_REPORT_ENV, type DoctorReport, writeDoctorReport } from "../../src/plugin-api/doctor-report.ts";

const slot = (name: string, provider: string, status: "active" | "declined" | "failed" = "active") =>
  ({ name, kind: "slot" as const, provider, status });

const healthy: DoctorReport = {
  providers: [
    slot("editor.session", "plugin-admin"),
    slot("scheduler.executor", "plugin-admin"),
    { name: "admin.pages", kind: "contribution", provider: "plugin-seo", status: "active" },
  ],
  scheduledActions: 0,
};

Deno.test("doctor: a healthy admin site lists its providers and has no problems", () => {
  const findings = capabilityFindings(healthy, { adminEnabled: true });
  assertEquals(findings.map((f) => f.severity), ["info"]);
  assertStringIncludes(findings[0].message, "editor.session");
  assertStringIncludes(findings[0].message, "plugin-admin");
  assertStringIncludes(findings[0].message, "plugin-seo");
});

Deno.test("doctor: an enabled admin that provides no editor.session is an error", () => {
  const findings = capabilityFindings({ providers: [], scheduledActions: 0 }, { adminEnabled: true });
  assertEquals(findings.map((f) => f.severity), ["error"]);
  assertStringIncludes(findings[0].message, "editor.session");
  assertStringIncludes(findings[0].message, "admin.enabled: false");
});

Deno.test("doctor: no editor.session is fine when the admin is switched off", () => {
  assertEquals(capabilityFindings({ providers: [], scheduledActions: 0 }, { adminEnabled: false }), []);
});

Deno.test("doctor: a provider whose factory threw is an error even when another slot is fine", () => {
  const findings = capabilityFindings(
    { providers: [slot("editor.session", "my-admin", "failed")], scheduledActions: 0 },
    { adminEnabled: false },
  );
  const errors = findings.filter((f) => f.severity === "error");
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0].message, "my-admin");
  assertStringIncludes(errors[0].message, "capabilities.provider_failed");
});

Deno.test("doctor: an admin whose editor.session failed is reported as the failure and as missing", () => {
  const findings = capabilityFindings(
    { providers: [slot("editor.session", "my-admin", "failed")], scheduledActions: 0 },
    { adminEnabled: true },
  );
  assertEquals(findings.filter((f) => f.severity === "error").length, 2);
});

Deno.test("doctor: queued scheduled actions with no executor are a warning", () => {
  const findings = capabilityFindings(
    { providers: [slot("editor.session", "plugin-admin")], scheduledActions: 3 },
    { adminEnabled: true },
  );
  const warnings = findings.filter((f) => f.severity === "warning");
  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0].message, "3 scheduled action");
});

Deno.test("doctor: scheduled actions with an executor are fine", () => {
  assertEquals(
    capabilityFindings({ ...healthy, scheduledActions: 3 }, { adminEnabled: true }).filter((f) => f.severity !== "info"),
    [],
  );
});

Deno.test("writeDoctorReport: writes the report only when a doctor run asked for it", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/r.json`;
  try {
    await writeDoctorReport(() => Promise.resolve(healthy)); // env unset
    assertEquals(await Deno.stat(path).then(() => true, () => false), false);

    Deno.env.set(DOCTOR_REPORT_ENV, path);
    await writeDoctorReport(() => Promise.resolve(healthy));
    assertEquals(JSON.parse(await Deno.readTextFile(path)), healthy);

    // A failing build never throws into the site's boot.
    await writeDoctorReport(() => Promise.reject(new Error("boom")));
  } finally {
    Deno.env.delete(DOCTOR_REPORT_ENV);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("doctor: an editor.session provided by two plugins is an error that names both", () => {
  const findings = capabilityFindings(
    {
      providers: [slot("editor.session", "login-a")],
      conflicts: [{ capability: "editor.session", providers: ["login-a", "login-b"] }],
      scheduledActions: 0,
    },
    { adminEnabled: true },
  );
  const errors = findings.filter((f) => f.severity === "error");
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0].message, '"login-a", "login-b"');
});
