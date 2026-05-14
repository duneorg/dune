/**
 * Tests for src/core/logger.ts
 *
 * Output is captured via the custom `write` option so tests are fully
 * hermetic — they never touch global console methods or the process-global
 * logger singleton.
 */

import {
  assertEquals,
  assertMatch,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createLogger, generateRequestId } from "../../src/core/logger.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all lines emitted by a logger action. */
function capture(action: (lines: string[]) => void): string[] {
  const lines: string[] = [];
  action(lines);
  return lines;
}

// ── Text format ───────────────────────────────────────────────────────────────

Deno.test("createLogger text format emits human-readable output on info", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "text", write: (l) => lines.push(l) });

  log.info("page.built", { route: "/blog/hello", durationMs: 12 });

  assertEquals(lines.length, 1);
  // Level tag and event name should appear in the line
  assertMatch(lines[0], /INFO/);
  assertMatch(lines[0], /page\.built/);
  // Fields should appear as key=value pairs
  assertMatch(lines[0], /route=/);
  assertMatch(lines[0], /durationMs=12/);
});

Deno.test("text format includes level prefix and event name", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "text", write: (l) => lines.push(l) });

  log.warn("mdx.error", { sourcePath: "content/foo.mdx" });

  assertEquals(lines.length, 1);
  assertMatch(lines[0], /WARN/);
  assertMatch(lines[0], /mdx\.error/);
  assertMatch(lines[0], /sourcePath=/);
});

Deno.test("text format works for all four levels", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "text", level: "debug", write: (l) => lines.push(l) });

  log.debug("d", {});
  log.info("i", {});
  log.warn("w", {});
  log.error("e", {});

  assertEquals(lines.length, 4);
  assertMatch(lines[0], /DEBUG/);
  assertMatch(lines[1], /INFO/);
  assertMatch(lines[2], /WARN/);
  assertMatch(lines[3], /ERROR/);
});

// ── JSON format ───────────────────────────────────────────────────────────────

Deno.test("createLogger json format emits valid JSON with correct fields", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", write: (l) => lines.push(l) });

  log.info("page.built", { route: "/blog/hello", durationMs: 12, template: "post" });

  assertEquals(lines.length, 1);

  const obj = JSON.parse(lines[0]) as Record<string, unknown>;
  assertEquals(obj.level, "info");
  assertEquals(obj.event, "page.built");
  assertEquals(obj.route, "/blog/hello");
  assertEquals(obj.durationMs, 12);
  assertEquals(obj.template, "post");
});

Deno.test("JSON output includes ts, level, event fields", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", write: (l) => lines.push(l) });

  log.error("mdx.error", { sourcePath: "content/foo.mdx", message: "unexpected token" });

  const obj = JSON.parse(lines[0]) as Record<string, unknown>;
  assert("ts" in obj, "ts field must be present");
  assert("level" in obj, "level field must be present");
  assert("event" in obj, "event field must be present");
  assertEquals(obj.level, "error");
  assertEquals(obj.event, "mdx.error");
  // ts should be a valid ISO date string
  assertMatch(String(obj.ts), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

Deno.test("JSON format emits one object per line (NDJSON)", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", write: (l) => lines.push(l) });

  log.info("a");
  log.info("b");
  log.info("c");

  assertEquals(lines.length, 3);
  for (const line of lines) {
    // Each line must be valid standalone JSON
    JSON.parse(line); // throws if invalid
  }
});

// ── Level filtering ───────────────────────────────────────────────────────────

Deno.test("createLogger level warn suppresses debug and info", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", level: "warn", write: (l) => lines.push(l) });

  log.debug("debug.msg");
  log.info("info.msg");

  assertEquals(lines.length, 0, "debug and info should be suppressed at warn level");
});

Deno.test("createLogger level warn emits warn and error", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", level: "warn", write: (l) => lines.push(l) });

  log.warn("warn.msg", { x: 1 });
  log.error("error.msg", { x: 2 });

  assertEquals(lines.length, 2);
  const w = JSON.parse(lines[0]) as Record<string, unknown>;
  const e = JSON.parse(lines[1]) as Record<string, unknown>;
  assertEquals(w.level, "warn");
  assertEquals(e.level, "error");
});

Deno.test("level error suppresses debug, info, warn", () => {
  const lines: string[] = [];
  const log = createLogger({ format: "json", level: "error", write: (l) => lines.push(l) });

  log.debug("d");
  log.info("i");
  log.warn("w");

  assertEquals(lines.length, 0);

  log.error("e");
  assertEquals(lines.length, 1);
});

// ── Child logger ──────────────────────────────────────────────────────────────

Deno.test("child merges parent fields into every child log line", () => {
  const lines: string[] = [];
  const parent = createLogger({ format: "json", write: (l) => lines.push(l) });

  const child = parent.child({ requestId: "abc12345", userId: "u1" });
  child.info("request.start", { method: "GET" });

  assertEquals(lines.length, 1);
  const obj = JSON.parse(lines[0]) as Record<string, unknown>;
  assertEquals(obj.requestId, "abc12345");
  assertEquals(obj.userId, "u1");
  assertEquals(obj.method, "GET");
  assertEquals(obj.event, "request.start");
});

Deno.test("child fields do not bleed into parent logger", () => {
  const lines: string[] = [];
  const parent = createLogger({ format: "json", write: (l) => lines.push(l) });
  const child = parent.child({ requestId: "xyz" });

  child.info("child.event");
  parent.info("parent.event");

  assertEquals(lines.length, 2);
  const childObj = JSON.parse(lines[0]) as Record<string, unknown>;
  const parentObj = JSON.parse(lines[1]) as Record<string, unknown>;

  assertEquals(childObj.requestId, "xyz");
  assert(!("requestId" in parentObj), "parent should not have child's requestId");
});

Deno.test("child inherits parent level filter", () => {
  const lines: string[] = [];
  const parent = createLogger({ format: "json", level: "error", write: (l) => lines.push(l) });
  const child = parent.child({ requestId: "xyz" });

  child.info("should.be.suppressed");
  assertEquals(lines.length, 0);

  child.error("should.emit");
  assertEquals(lines.length, 1);
});

// ── generateRequestId ─────────────────────────────────────────────────────────

Deno.test("generateRequestId returns 8-char hex string", () => {
  const id = generateRequestId();
  assertEquals(id.length, 8);
  assertMatch(id, /^[0-9a-f]{8}$/);
});

Deno.test("generateRequestId generates unique IDs", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
  // With 4 random bytes, collisions in 100 draws are astronomically unlikely
  assert(ids.size >= 99, "expected near-unique IDs across 100 generations");
});

// ── Bound fields at creation ──────────────────────────────────────────────────

Deno.test("createLogger fields option bound to every log line", () => {
  const lines: string[] = [];
  const log = createLogger({
    format: "json",
    fields: { service: "dune", env: "test" },
    write: (l) => lines.push(l),
  });

  log.info("startup");
  log.warn("disk.full", { path: "/tmp" });

  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    assertEquals(obj.service, "dune");
    assertEquals(obj.env, "test");
  }
});
