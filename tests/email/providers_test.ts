/**
 * Tests for email providers.
 */

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ConsoleEmailProvider } from "../../src/email/providers/console.ts";
import { ResendEmailProvider } from "../../src/email/providers/resend.ts";
import { PostmarkEmailProvider } from "../../src/email/providers/postmark.ts";
import { SmtpEmailProvider } from "../../src/email/providers/smtp.ts";
import type { EmailMessage } from "../../src/email/types.ts";

const sampleMessage: EmailMessage = {
  to: "recipient@example.com",
  subject: "Test subject",
  html: "<p>Hello world</p>",
  text: "Hello world",
  from: "sender@example.com",
};

// ─── ConsoleEmailProvider ────────────────────────────────────────────────────

Deno.test("ConsoleEmailProvider.send() does not throw", async () => {
  const provider = new ConsoleEmailProvider();
  // Should resolve without throwing
  await provider.send(sampleMessage);
});

Deno.test("ConsoleEmailProvider.send() accepts array to", async () => {
  const provider = new ConsoleEmailProvider();
  await provider.send({ ...sampleMessage, to: ["a@example.com", "b@example.com"] });
});

// ─── ResendEmailProvider ─────────────────────────────────────────────────────

Deno.test("ResendEmailProvider.send() calls correct URL with correct headers", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit = {};

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedInit = init ?? {};
    return new Response(JSON.stringify({ id: "test-id" }), { status: 200 });
  };

  try {
    const provider = new ResendEmailProvider({
      apiKey: "re_test_123",
      from: "default@example.com",
    });

    await provider.send(sampleMessage);

    assertEquals(capturedUrl, "https://api.resend.com/emails");

    const headers = capturedInit.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer re_test_123");
    assertEquals(headers["Content-Type"], "application/json");

    const body = JSON.parse(capturedInit.body as string);
    assertEquals(body.from, "sender@example.com"); // message.from overrides provider from
    assertEquals(body.subject, "Test subject");
    assert(Array.isArray(body.to));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ResendEmailProvider.send() uses provider from when message.from is absent", async () => {
  let capturedBody = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response("{}", { status: 200 });
  };

  try {
    const provider = new ResendEmailProvider({
      apiKey: "re_test_123",
      from: "default@example.com",
    });

    await provider.send({ to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" });

    const body = JSON.parse(capturedBody);
    assertEquals(body.from, "default@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ResendEmailProvider.send() throws on non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

  try {
    const provider = new ResendEmailProvider({ apiKey: "bad", from: "f@example.com" });
    await assertRejects(
      () => provider.send(sampleMessage),
      Error,
      "Resend API error 401",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── PostmarkEmailProvider ────────────────────────────────────────────────────

Deno.test("PostmarkEmailProvider.send() uses correct header name", async () => {
  let capturedHeaders: Record<string, string> = {};

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers as Record<string, string>;
    return new Response("{}", { status: 200 });
  };

  try {
    const provider = new PostmarkEmailProvider({
      apiKey: "pm_test_key",
      from: "default@example.com",
    });

    await provider.send(sampleMessage);

    assertEquals(capturedHeaders["X-Postmark-Server-Token"], "pm_test_key");
    assertEquals(capturedHeaders["Content-Type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("PostmarkEmailProvider.send() uses PascalCase body fields", async () => {
  let capturedBody = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response("{}", { status: 200 });
  };

  try {
    const provider = new PostmarkEmailProvider({
      apiKey: "pm_test_key",
      from: "default@example.com",
    });

    await provider.send(sampleMessage);

    const body = JSON.parse(capturedBody);
    assert("From" in body, "Expected 'From' field");
    assert("To" in body, "Expected 'To' field");
    assert("Subject" in body, "Expected 'Subject' field");
    assert("HtmlBody" in body, "Expected 'HtmlBody' field");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── SmtpEmailProvider ────────────────────────────────────────────────────────

Deno.test("SmtpEmailProvider accepts config without throwing", () => {
  // Just constructing the provider should not throw — we don't actually connect
  const provider = new SmtpEmailProvider({
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "user@example.com",
    pass: "secret",
    from: "noreply@example.com",
  });

  assert(provider !== null);
});

Deno.test("SmtpEmailProvider accepts $ENV_VAR pass without throwing", () => {
  const provider = new SmtpEmailProvider({
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "user",
    pass: "$SMTP_PASS",
    from: "noreply@example.com",
  });

  assert(provider !== null);
});
