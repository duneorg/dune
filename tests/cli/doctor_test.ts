/**
 * Tests for `dune doctor` (src/cli/doctor.ts) — environment/runtime health
 * checks, distinct from `dune validate`'s project-correctness checks.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { evaluateDenoVersion, runDoctorChecks, searchDegradedFindings } from "../../src/cli/doctor.ts";

// ── evaluateDenoVersion (pure) ────────────────────────────────────────────────

Deno.test("evaluateDenoVersion: no finding for a supported Deno 2.x version", () => {
  assertEquals(evaluateDenoVersion("2.1.4"), []);
});

Deno.test("evaluateDenoVersion: no finding for a future Deno 3.x version", () => {
  assertEquals(evaluateDenoVersion("3.0.0"), []);
});

Deno.test("evaluateDenoVersion: error finding for an unsupported Deno 1.x version", () => {
  const findings = evaluateDenoVersion("1.44.4");
  assertEquals(findings.length, 1);
  assertEquals(findings[0].category, "deno-version");
  assertEquals(findings[0].severity, "error");
  assertMatch(findings[0].message, /1\.44\.4/);
});

Deno.test("evaluateDenoVersion: error finding for an unparseable version string", () => {
  const findings = evaluateDenoVersion("not-a-version");
  assertEquals(findings.length, 1);
  assertEquals(findings[0].severity, "error");
});

// ── runDoctorChecks: resolution + lockfile (real subprocess + real fs) ───────

async function writeMinimalSite(root: string, opts: { withMainTs?: boolean } = {}) {
  await Deno.mkdir(join(root, "config"), { recursive: true });
  await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: Doctor Test Site\n");
  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({
      imports: { "@std/path": "jsr:@std/path@^1", "@dune/core": "jsr:@dune/core@^0.34" },
      compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" },
    }),
  );
  if (opts.withMainTs !== false) {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { join } from "@std/path";\nconsole.log(join("a", "b"));\n`,
    );
  }
}

Deno.test(
  "runDoctorChecks: no resolution finding when main.ts's dependencies resolve cleanly",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_ok_" });
    try {
      await writeMinimalSite(root);
      const findings = await runDoctorChecks(root);
      assertEquals(findings.filter((f) => f.category === "resolution" || f.category === "npm-cache"), []);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: reports a resolution error when main.ts imports something that can't resolve",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_broken_" });
    try {
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: Doctor Test Site\n");
      await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ imports: {} }));
      await Deno.writeTextFile(
        join(root, "main.ts"),
        `import { nope } from "jsr:@dune/definitely-not-a-real-package@999.0.0";\nnope();\n`,
      );
      const findings = await runDoctorChecks(root);
      const resolutionFindings = findings.filter((f) => f.category === "resolution" || f.category === "npm-cache");
      assertEquals(resolutionFindings.length, 1);
      assertEquals(resolutionFindings[0].severity, "error");
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: no resolution finding (skipped) when the site has no main.ts",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_nomain_" });
    try {
      await writeMinimalSite(root, { withMainTs: false });
      const findings = await runDoctorChecks(root);
      assertEquals(findings.filter((f) => f.category === "resolution" || f.category === "npm-cache"), []);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: surfaces lockfile staleness as a warning, not an error",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_lockfile_" });
    try {
      await writeMinimalSite(root);
      await Deno.writeTextFile(join(root, "deno.lock"), JSON.stringify({ version: "5", specifiers: {} }));
      const findings = await runDoctorChecks(root);
      const lockfileFindings = findings.filter((f) => f.category === "lockfile");
      assertEquals(lockfileFindings.length, 1);
      assertEquals(lockfileFindings[0].severity, "warning");
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: no boot finding by default (opt-in only)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_noboot_" });
    try {
      await writeMinimalSite(root, { withMainTs: false });
      const findings = await runDoctorChecks(root);
      assertEquals(findings.filter((f) => f.category === "boot"), []);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: --boot succeeds (no finding) against a main.ts that actually serves",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_boot_ok_" });
    try {
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: Doctor Boot Test\n");
      await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ imports: {} }));
      // Ignores the "dev"/--port-shaped argv dune real sites get — this fixture
      // only needs to *look* bootable to runBootCheck, which passes
      // ["dev", "--port", "<n>"] the same way the real dev task does.
      await Deno.writeTextFile(
        join(root, "main.ts"),
        `const portFlag = Deno.args.indexOf("--port");\n` +
          `const port = portFlag >= 0 ? parseInt(Deno.args[portFlag + 1]) : 3000;\n` +
          `Deno.serve({ port }, () => new Response("ok"));\n`,
      );
      const findings = await runDoctorChecks(root, { boot: true });
      assertEquals(findings.filter((f) => f.category === "boot"), []);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: --boot reports a warning (not silence) when there's no main.ts to boot",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_boot_nomain_" });
    try {
      await writeMinimalSite(root, { withMainTs: false });
      const findings = await runDoctorChecks(root, { boot: true });
      const bootFindings = findings.filter((f) => f.category === "boot");
      assertEquals(bootFindings.length, 1);
      assertEquals(bootFindings[0].severity, "warning");
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test("searchDegradedFindings: silent unless /health says degraded", () => {
  assertEquals(searchDegradedFindings("ok", ""), []);
  assertEquals(searchDegradedFindings(undefined, ""), []);
});

Deno.test("searchDegradedFindings: a warning that names the failed engine from the boot log", () => {
  const log = [
    "starting",
    '\x1b[33m[WARN] \x1b[0m search.engine.failed  engine="meilisearch" op="build" reason="fetch failed"',
  ].join("\n");
  const [finding] = searchDegradedFindings("degraded", log);
  assertEquals(finding.severity, "warning");
  assertEquals(finding.message.includes('engine="meilisearch"'), true);
  assertEquals(finding.message.includes("\x1b"), false);
});

async function bootFixture(report: string | null): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_doctor_report_" });
  await Deno.mkdir(join(root, "config"), { recursive: true });
  await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: Doctor Report Test\n");
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ imports: {} }));
  // Stands in for a booted site: serves, and (like core) writes the capability
  // report to the file the doctor names.
  await Deno.writeTextFile(
    join(root, "main.ts"),
    `const portFlag = Deno.args.indexOf("--port");\n` +
      `const port = portFlag >= 0 ? parseInt(Deno.args[portFlag + 1]) : 3000;\n` +
      (report === null ? "" : `const f = Deno.env.get("DUNE_DOCTOR_REPORT"); if (f) await Deno.writeTextFile(f, ${JSON.stringify(report)});\n`) +
      `Deno.serve({ port }, () => new Response("ok"));\n`,
  );
  return root;
}

Deno.test(
  "runDoctorChecks: --boot reads the booted site's capability report",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await bootFixture(JSON.stringify({ providers: [], scheduledActions: 0 }));
    try {
      // admin.enabled defaults to true, and this "site" provides no editor.session.
      const findings = await runDoctorChecks(root, { boot: true });
      const caps = findings.filter((f) => f.category === "capabilities");
      assertEquals(caps.map((f) => f.severity), ["error"]);
      assertStringIncludes(caps[0].message, "editor.session");
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "runDoctorChecks: --boot warns when the site does not report its capabilities",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await bootFixture(null);
    try {
      const caps = (await runDoctorChecks(root, { boot: true })).filter((f) => f.category === "capabilities");
      assertEquals(caps.map((f) => f.severity), ["warning"]);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
