/**
 * Tests for POST /admin/api/dev/apply — validation logic.
 *
 * We test the pure validation logic (validateChange, path checking, YAML parsing)
 * by invoking the route's exported handler via lightweight HTTP stubs that
 * simulate dev-mode context without requiring a full engine bootstrap.
 *
 * All filesystem operations are tested with dry_run:true so no files are written.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// We test the validation helpers by importing and calling the route handler
// with a fake FreshContext. The route uses Deno.cwd() + config.system.content.dir
// for path resolution — in dry_run mode no filesystem access occurs beyond the
// `Deno.stat` call to determine would_create vs would_update.

// ---------------------------------------------------------------------------
// Import validateChange from the route (exported only for testing via Reflect)
// ---------------------------------------------------------------------------

// Since validateChange is not exported, we import the handler and test it
// indirectly through the HTTP interface with minimal stubs.

type Change = { op: string; path: string; content?: string; patch?: Record<string, unknown> };

/**
 * Invoke the route handler with a fake request and admin context.
 * Returns the parsed JSON response body.
 */
async function callApply(body: unknown): Promise<Record<string, unknown>> {
  const { handler } = await import("../../../src/admin/routes/api/dev/apply.ts");

  const req = new Request("http://localhost/admin/api/dev/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "origin": "http://localhost",
      "host": "localhost",
    },
    body: JSON.stringify(body),
  });

  // Minimal AdminState stub
  const ctx = {
    req,
    url: new URL(req.url),
    state: {
      auth: { authenticated: true, user: { id: "1", role: "admin" } },
      adminContext: {
        auth: {
          hasPermission: (_auth: unknown, _perm: string) => true,
        },
        auditLogger: null,
        config: {
          system: {
            debug: true, // dev mode
            content: { dir: "content", markdown: { extra: false, auto_links: false, auto_url_links: false } },
          },
        },
      },
    },
    next: () => new Response("not found", { status: 404 }),
  };

  // Temporarily set DUNE_ENV so isDevMode() returns true via env var
  const original = Deno.env.get("DUNE_ENV");
  Deno.env.set("DUNE_ENV", "dev");

  try {
    const res = await (handler as { POST: (ctx: unknown) => Promise<Response> }).POST(ctx);
    const json = await res.json();
    return json as Record<string, unknown>;
  } finally {
    if (original !== undefined) {
      Deno.env.set("DUNE_ENV", original);
    } else {
      Deno.env.delete("DUNE_ENV");
    }
  }
}

// ---------------------------------------------------------------------------
// Validation tests (all using dry_run: true)
// ---------------------------------------------------------------------------

Deno.test("dev/apply: rejects request with no changes", async () => {
  const res = await callApply({ dry_run: true, changes: [] });
  assertExists(res.error);
  assertEquals(typeof res.error, "string");
});

Deno.test("dev/apply: rejects missing op", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ path: "content/test.md", content: "hello" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("op")), true);
});

Deno.test("dev/apply: rejects invalid op name", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "hack", path: "content/test.md" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("op must be one of")), true);
});

Deno.test("dev/apply: rejects path traversal attempt", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "write", path: "../../../etc/passwd", content: "evil" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("invalid") || e.includes("traversal")), true);
});

Deno.test("dev/apply: rejects absolute path", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "write", path: "/etc/passwd", content: "evil" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
});

Deno.test("dev/apply: rejects disallowed file extension", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "write", path: "content/test.exe", content: "evil" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes(".md")), true);
});

Deno.test("dev/apply: rejects write without content field", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "write", path: "content/test.md" }], // no content
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("content")), true);
});

Deno.test("dev/apply: rejects invalid YAML frontmatter in markdown", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{
      op: "write",
      path: "content/test.md",
      content: "---\ntitle: [unclosed bracket\n---\n\nBody",
    }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.toLowerCase().includes("yaml")), true);
});

Deno.test("dev/apply: accepts valid write in dry_run mode", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{
      op: "write",
      path: "content/hello.md",
      content: "---\ntitle: Hello\npublished: true\n---\n\n# Hello World",
    }],
  });
  assertEquals(res.dry_run, true);
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].errors, []);
  assertEquals(
    results[0].status === "would_create" || results[0].status === "would_update",
    true,
  );
});

Deno.test("dev/apply: accepts valid frontmatter patch in dry_run mode", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{
      op: "frontmatter",
      path: "content/hello.md",
      patch: { title: "Updated Title", published: true },
    }],
  });
  assertEquals(res.dry_run, true);
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].errors, []);
});

Deno.test("dev/apply: accepts valid delete in dry_run mode", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{
      op: "delete",
      path: "content/old.md",
    }],
  });
  assertEquals(res.dry_run, true);
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].errors, []);
  assertEquals(results[0].status, "would_delete");
});

Deno.test("dev/apply: summary counts are correct", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [
      { op: "write", path: "content/good.md", content: "---\ntitle: Good\n---" },
      { op: "write", path: "/absolute/bad.md", content: "bad" }, // invalid
    ],
  });
  const summary = res.summary as { total: number; valid: number; errors: number };
  assertEquals(summary.total, 2);
  assertEquals(summary.valid, 1);
  assertEquals(summary.errors, 1);
});

Deno.test("dev/apply: rejects frontmatter op without patch", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "frontmatter", path: "content/test.md" }], // no patch
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("patch")), true);
});

// ---------------------------------------------------------------------------
// config op tests
// ---------------------------------------------------------------------------

Deno.test("dev/apply: config op accepts valid key+value in dry_run mode", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "config", key: "admin.path", value: "/cms" }],
  });
  assertEquals(res.dry_run, true);
  const results = res.results as { op: string; key: string; status: string; errors: string[] }[];
  assertEquals(results[0].op, "config");
  assertEquals(results[0].key, "admin.path");
  assertEquals(results[0].status, "would_update");
  assertEquals(results[0].errors, []);
});

Deno.test("dev/apply: config op rejects missing key", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "config", value: "/cms" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("key")), true);
});

Deno.test("dev/apply: config op rejects missing value", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "config", key: "admin.path" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("value")), true);
});

Deno.test("dev/apply: config op rejects invalid key format", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "config", key: "admin path", value: "x" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("key")), true);
});

// ---------------------------------------------------------------------------
// plugin.install op tests
// ---------------------------------------------------------------------------

Deno.test("dev/apply: plugin.install accepts valid jsr spec in dry_run mode", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "plugin.install", spec: "jsr:@dune/blog@1.0.0" }],
  });
  assertEquals(res.dry_run, true);
  const results = res.results as { op: string; spec: string; status: string; errors: string[] }[];
  assertEquals(results[0].op, "plugin.install");
  assertEquals(results[0].spec, "jsr:@dune/blog@1.0.0");
  assertEquals(results[0].status, "would_create");
  assertEquals(results[0].errors, []);
});

Deno.test("dev/apply: plugin.install accepts npm spec", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "plugin.install", spec: "npm:some-dune-plugin" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].errors, []);
  assertEquals(results[0].status, "would_create");
});

Deno.test("dev/apply: plugin.install rejects missing spec", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "plugin.install" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("spec")), true);
});

Deno.test("dev/apply: plugin.install rejects invalid spec format", async () => {
  const res = await callApply({
    dry_run: true,
    changes: [{ op: "plugin.install", spec: "my-random-plugin" }],
  });
  const results = res.results as { status: string; errors: string[] }[];
  assertEquals(results[0].status, "error");
  assertEquals(results[0].errors.some((e: string) => e.includes("jsr:")), true);
});
