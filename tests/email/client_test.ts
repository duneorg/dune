/**
 * Tests for the EmailClient public API.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEmailClient } from "../../src/email/client.ts";
import type { EmailMessage, EmailProvider } from "../../src/email/types.ts";
import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "../../src/storage/types.ts";

// ─── Mock provider ────────────────────────────────────────────────────────────

function mockProvider(): { provider: EmailProvider; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    async send(message: EmailMessage): Promise<void> {
      sent.push(message);
    },
  };
  return { provider, sent };
}

// ─── Mock storage ─────────────────────────────────────────────────────────────

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

// ─── send({ to, subject, html }) ─────────────────────────────────────────────

Deno.test("send({ to, subject, html }) calls provider with correct message", async () => {
  const { provider, sent } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" });

  await client.send({
    to: "user@example.com",
    subject: "Hello!",
    html: "<p>World</p>",
  });

  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "user@example.com");
  assertEquals(sent[0].subject, "Hello!");
  assertEquals(sent[0].html, "<p>World</p>");
  // from should fall back to the client default
  assertEquals(sent[0].from, "default@example.com");
});

Deno.test("send({ to, subject, html }) uses per-message from override", async () => {
  const { provider, sent } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" });

  await client.send({
    to: "user@example.com",
    subject: "Hi",
    html: "<p>Hi</p>",
    from: "override@example.com",
  });

  assertEquals(sent[0].from, "override@example.com");
});

Deno.test("send() with array to passes array to provider", async () => {
  const { provider, sent } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" });

  await client.send({
    to: ["a@example.com", "b@example.com"],
    subject: "Bulk",
    html: "<p>Hi all</p>",
  });

  assertEquals(sent[0].to, ["a@example.com", "b@example.com"]);
});

// ─── send({ to, template, data }) ────────────────────────────────────────────

Deno.test("send({ to, template, data }) renders template and calls provider", async () => {
  const { provider, sent } = mockProvider();
  const storage = mockStorage({
    "emails/welcome.email.md": "# Welcome {{name}}\n\nHello {{name}}.",
  });
  const client = createEmailClient({
    provider,
    from: "default@example.com",
    storage,
    emailsDir: "emails",
  });

  await client.send({
    to: "alice@example.com",
    template: "welcome",
    data: { name: "Alice" },
  });

  assertEquals(sent.length, 1);
  assertEquals(sent[0].subject, "Welcome Alice");
  assertEquals(sent[0].to, "alice@example.com");
  // html should contain rendered content
  assertEquals(sent[0].html.includes("Alice"), true);
});

Deno.test("send({ to, template, data }) uses caller subject when provided", async () => {
  const { provider, sent } = mockProvider();
  const storage = mockStorage({
    "emails/order.email.md": "# Default Subject\n\nOrder confirmed.",
  });
  const client = createEmailClient({ provider, from: "default@example.com", storage, emailsDir: "emails" });

  await client.send({
    to: "buyer@example.com",
    template: "order",
    subject: "Your Order #42",
    data: {},
  });

  // caller-provided subject should override the template subject
  assertEquals(sent[0].subject, "Your Order #42");
});

// ─── Error cases ──────────────────────────────────────────────────────────────

Deno.test("send() without subject or template throws clear error", async () => {
  const { provider } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" });

  await assertRejects(
    () => client.send({ to: "user@example.com", html: "<p>Hi</p>" }),
    Error,
    "subject",
  );
});

Deno.test("send() without html or template throws clear error", async () => {
  const { provider } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" });

  await assertRejects(
    () => client.send({ to: "user@example.com", subject: "Hi" } as Parameters<typeof client.send>[0]),
    Error,
  );
});

Deno.test("send() with unknown template name throws clear error", async () => {
  const { provider } = mockProvider();
  const storage = mockStorage({});
  const client = createEmailClient({ provider, from: "default@example.com", storage, emailsDir: "emails" });

  await assertRejects(
    () => client.send({ to: "user@example.com", template: "nonexistent", data: {} }),
    Error,
    "not found",
  );
});

Deno.test("send() with template but no storage throws clear error", async () => {
  const { provider } = mockProvider();
  const client = createEmailClient({ provider, from: "default@example.com" }); // no storage

  await assertRejects(
    () => client.send({ to: "user@example.com", template: "welcome", data: {} }),
    Error,
    "StorageAdapter",
  );
});
