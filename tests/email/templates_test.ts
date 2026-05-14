/**
 * Tests for email template loading and rendering.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadTemplate } from "../../src/email/templates.ts";
import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "../../src/storage/types.ts";

// ─── Mock StorageAdapter ──────────────────────────────────────────────────────

/**
 * Build a minimal StorageAdapter that serves fixed template content.
 * Only `exists()` and `readText()` are used by the template engine.
 */
function mockStorage(files: Record<string, string>): StorageAdapter {
  return {
    async read(path: string): Promise<Uint8Array> {
      const text = files[path];
      if (text === undefined) throw new Error(`File not found: ${path}`);
      return new TextEncoder().encode(text);
    },
    async readText(path: string): Promise<string> {
      const text = files[path];
      if (text === undefined) throw new Error(`File not found: ${path}`);
      return text;
    },
    async write(_path: string, _data: Uint8Array | string): Promise<void> {},
    async exists(path: string): Promise<boolean> {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
    async delete(_path: string): Promise<void> {},
    async rename(_oldPath: string, _newPath: string): Promise<void> {},
    async list(_path: string): Promise<StorageEntry[]> { return []; },
    async listRecursive(_path: string): Promise<StorageEntry[]> { return []; },
    async stat(_path: string): Promise<StorageStat> {
      return { size: 0, mtime: 0, isFile: true, isDirectory: false };
    },
    async getJSON<T>(_key: string): Promise<T | null> { return null; },
    async setJSON<T>(_key: string, _value: T, _ttl?: number): Promise<void> {},
    async deleteJSON(_key: string): Promise<void> {},
    watch(_path: string, _callback: (event: WatchEvent) => void): () => void {
      return () => {};
    },
  };
}

// ─── Markdown template tests ──────────────────────────────────────────────────

Deno.test("loadTemplate: .email.md with {{name}} substitution", async () => {
  const storage = mockStorage({
    "emails/welcome.email.md": `# Welcome, {{name}}!\n\nHello {{name}}, thanks for joining.\n`,
  });

  const template = await loadTemplate("welcome", storage, "emails");
  assert_not_null(template);

  const result = await template!.render({ name: "Alice" });

  assertEquals(result.subject, "Welcome, Alice!");
  assertStringIncludes(result.html, "Alice");
  assertStringIncludes(result.html, "thanks for joining");
});

Deno.test("loadTemplate: .email.md extracts subject from first # heading", async () => {
  const storage = mockStorage({
    "emails/invoice.email.md": `# Your Invoice #{{id}}\n\nPlease pay by {{due}}.\n`,
  });

  const template = await loadTemplate("invoice", storage, "emails");
  assert_not_null(template);

  const result = await template!.render({ id: "INV-001", due: "2026-06-01" });

  assertEquals(result.subject, "Your Invoice #INV-001");
  // Heading should not appear in the body HTML
  assertStringIncludes(result.html, "Please pay by 2026-06-01");
});

Deno.test("loadTemplate: .email.md unknown placeholder key is left unchanged", async () => {
  const storage = mockStorage({
    "emails/test.email.md": `# Test\n\n{{known}} and {{unknown}}\n`,
  });

  const template = await loadTemplate("test", storage, "emails");
  assert_not_null(template);

  const result = await template!.render({ known: "VALUE" });

  assertStringIncludes(result.html, "VALUE");
  assertStringIncludes(result.html, "{{unknown}}");
});

Deno.test("loadTemplate: .email.md produces plain text output", async () => {
  const storage = mockStorage({
    "emails/plain.email.md": `# Hello\n\nThis is a paragraph.\n`,
  });

  const template = await loadTemplate("plain", storage, "emails");
  assert_not_null(template);

  const result = await template!.render({});

  // text should be defined and not contain HTML tags
  assertEquals(typeof result.text, "string");
  assertEquals((result.text ?? "").includes("<"), false);
  assertStringIncludes(result.text ?? "", "paragraph");
});

// ─── loadTemplate null-return tests ──────────────────────────────────────────

Deno.test("loadTemplate returns null for non-existent template name", async () => {
  const storage = mockStorage({
    "emails/welcome.email.md": "# Hi\n\nHello.",
  });

  const result = await loadTemplate("does-not-exist", storage, "emails");
  assertEquals(result, null);
});

Deno.test("loadTemplate returns null when emails dir is empty", async () => {
  const storage = mockStorage({});

  const result = await loadTemplate("welcome", storage, "emails");
  assertEquals(result, null);
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function assert_not_null<T>(value: T | null): asserts value is T {
  if (value === null) {
    throw new Error("Expected non-null value but got null");
  }
}
