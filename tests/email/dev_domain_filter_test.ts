/**
 * Tests for DUNE_EMAIL_DEV_ALLOWED_DOMAINS — the domain-allowlist middle
 * ground between refusing all real sends under DUNE_ENV=dev (the default)
 * and DUNE_EMAIL_ALLOW_DEV_SEND=1 (unrestricted real sends). When set, a
 * real provider is constructed but wrapped so only recipients on an
 * allowed domain are actually sent for real; anything else redirects the
 * whole message to console.
 */

import {
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEmailProvider } from "../../src/email/providers/mod.ts";
import { ConsoleEmailProvider } from "../../src/email/providers/console.ts";
import { ResendEmailProvider } from "../../src/email/providers/resend.ts";
import { DevDomainFilterEmailProvider } from "../../src/email/providers/dev-domain-filter.ts";
import type { EmailMessage, EmailProvider } from "../../src/email/types.ts";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = Deno.env.get(key);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const resendConfig = {
  provider: "resend" as const,
  resend: { apiKey: "re_test_123" },
};

const baseMessage: EmailMessage = {
  to: "someone@example.com",
  subject: "Test",
  html: "<p>hi</p>",
};

class RecordingProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

// ── createEmailProvider() wiring ────────────────────────────────────────

Deno.test("createEmailProvider: DUNE_EMAIL_DEV_ALLOWED_DOMAINS wraps the real provider", () => {
  withEnv(
    {
      DUNE_ENV: "dev",
      DUNE_EMAIL_ALLOW_DEV_SEND: undefined,
      DUNE_EMAIL_DEV_ALLOWED_DOMAINS: "example.com",
    },
    () => {
      const provider = createEmailProvider(resendConfig);
      assertInstanceOf(provider, DevDomainFilterEmailProvider);
    },
  );
});

Deno.test("createEmailProvider: domain allowlist takes precedence even when DUNE_EMAIL_ALLOW_DEV_SEND=1 is also set", () => {
  withEnv(
    {
      DUNE_ENV: "dev",
      DUNE_EMAIL_ALLOW_DEV_SEND: "1",
      DUNE_EMAIL_DEV_ALLOWED_DOMAINS: "example.com",
    },
    () => {
      const provider = createEmailProvider(resendConfig);
      assertInstanceOf(provider, DevDomainFilterEmailProvider);
    },
  );
});

Deno.test("createEmailProvider: domain allowlist with missing credentials still falls back to plain console (not wrapped)", () => {
  withEnv(
    {
      DUNE_ENV: "dev",
      DUNE_EMAIL_ALLOW_DEV_SEND: undefined,
      DUNE_EMAIL_DEV_ALLOWED_DOMAINS: "example.com",
    },
    () => {
      const provider = createEmailProvider({ provider: "resend" });
      assertInstanceOf(provider, ConsoleEmailProvider);
    },
  );
});

Deno.test("createEmailProvider: domain allowlist has no effect outside dev", () => {
  withEnv(
    {
      DUNE_ENV: undefined,
      DUNE_EMAIL_ALLOW_DEV_SEND: undefined,
      DUNE_EMAIL_DEV_ALLOWED_DOMAINS: "example.com",
    },
    () => {
      const provider = createEmailProvider(resendConfig);
      assertInstanceOf(provider, ResendEmailProvider);
    },
  );
});

Deno.test("createEmailProvider: empty DUNE_EMAIL_DEV_ALLOWED_DOMAINS falls back to the plain dev-refusal gate", () => {
  withEnv(
    {
      DUNE_ENV: "dev",
      DUNE_EMAIL_ALLOW_DEV_SEND: undefined,
      DUNE_EMAIL_DEV_ALLOWED_DOMAINS: "",
    },
    () => {
      const provider = createEmailProvider(resendConfig);
      assertInstanceOf(provider, ConsoleEmailProvider);
    },
  );
});

// ── DevDomainFilterEmailProvider.send() behavior ────────────────────────

Deno.test("DevDomainFilterEmailProvider: recipient on an allowed domain sends for real", async () => {
  const real = new RecordingProvider();
  const fallback = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["example.com"],
    fallbackProvider: fallback,
  });

  await provider.send({ ...baseMessage, to: "someone@example.com" });

  assertEquals(real.sent.length, 1);
  assertEquals(fallback.sent.length, 0);
});

Deno.test("DevDomainFilterEmailProvider: recipient on a disallowed domain redirects to fallback", async () => {
  const real = new RecordingProvider();
  const fallback = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["example.com"],
    fallbackProvider: fallback,
  });

  await provider.send({ ...baseMessage, to: "someone@gmail.com" });

  assertEquals(real.sent.length, 0);
  assertEquals(fallback.sent.length, 1);
});

Deno.test("DevDomainFilterEmailProvider: one disallowed recipient redirects the WHOLE message, not a partial send", async () => {
  const real = new RecordingProvider();
  const fallback = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["example.com"],
    fallbackProvider: fallback,
  });

  await provider.send({
    ...baseMessage,
    to: ["ok@example.com", "not-ok@gmail.com"],
  });

  assertEquals(real.sent.length, 0);
  assertEquals(fallback.sent.length, 1);
  assertEquals(fallback.sent[0].to, ["ok@example.com", "not-ok@gmail.com"]);
});

Deno.test("DevDomainFilterEmailProvider: all recipients on allowed domains sends for real", async () => {
  const real = new RecordingProvider();
  const fallback = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["example.com", "test.co"],
    fallbackProvider: fallback,
  });

  await provider.send({
    ...baseMessage,
    to: ["a@example.com", "b@test.co"],
  });

  assertEquals(real.sent.length, 1);
  assertEquals(fallback.sent.length, 0);
});

Deno.test("DevDomainFilterEmailProvider: domain matching is case-insensitive", async () => {
  const real = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["Example.COM"],
    fallbackProvider: new RecordingProvider(),
  });

  await provider.send({ ...baseMessage, to: "someone@EXAMPLE.com" });

  assertEquals(real.sent.length, 1);
});

Deno.test("DevDomainFilterEmailProvider: defaults to a real ConsoleEmailProvider fallback when none given", async () => {
  const real = new RecordingProvider();
  const provider = new DevDomainFilterEmailProvider({
    realProvider: real,
    allowedDomains: ["example.com"],
  });

  // Just verify it doesn't throw and doesn't call the real provider.
  await provider.send({ ...baseMessage, to: "someone@gmail.com" });
  assertEquals(real.sent.length, 0);
});
