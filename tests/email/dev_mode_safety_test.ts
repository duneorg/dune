/**
 * Tests for createEmailProvider()'s dev-mode safety gate.
 *
 * Previously a validly configured live provider (real SMTP creds, a real
 * API key) sent real mail under DUNE_ENV=dev exactly as in production —
 * nothing distinguished the two. Now a live provider is refused and
 * swapped for ConsoleEmailProvider under DUNE_ENV=dev unless
 * DUNE_EMAIL_ALLOW_DEV_SEND=1 is also explicitly set.
 */

import {
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEmailProvider } from "../../src/email/providers/mod.ts";
import { ConsoleEmailProvider } from "../../src/email/providers/console.ts";
import { ResendEmailProvider } from "../../src/email/providers/resend.ts";

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

Deno.test("createEmailProvider: DUNE_ENV=dev refuses a live provider, falls back to console", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider(resendConfig);
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev + DUNE_EMAIL_ALLOW_DEV_SEND=1 allows the live provider", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: "1" }, () => {
    const provider = createEmailProvider(resendConfig);
    assertInstanceOf(provider, ResendEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev + DUNE_EMAIL_ALLOW_DEV_SEND=true allows the live provider", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: "true" }, () => {
    const provider = createEmailProvider(resendConfig);
    assertInstanceOf(provider, ResendEmailProvider);
  });
});

Deno.test("createEmailProvider: outside dev (DUNE_ENV unset), a live provider is unaffected", () => {
  withEnv({ DUNE_ENV: undefined, DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider(resendConfig);
    assertInstanceOf(provider, ResendEmailProvider);
  });
});

Deno.test("createEmailProvider: outside dev (DUNE_ENV=production), a live provider is unaffected", () => {
  withEnv(
    { DUNE_ENV: "production", DUNE_EMAIL_ALLOW_DEV_SEND: undefined },
    () => {
      const provider = createEmailProvider(resendConfig);
      assertInstanceOf(provider, ResendEmailProvider);
    },
  );
});

Deno.test("createEmailProvider: DUNE_ENV=dev with provider unset stays console (unaffected — was already console)", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({});
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev with provider explicitly 'console' stays console", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({ provider: "console" });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev refusal applies to smtp too", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({
      provider: "smtp",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        pass: "p",
      },
    });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev refusal applies to postmark too", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({
      provider: "postmark",
      postmark: { apiKey: "pm_test" },
    });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev refusal applies to sendgrid too", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({
      provider: "sendgrid",
      sendgrid: { apiKey: "sg_test" },
    });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_ENV=dev refusal still falls back to console even with missing credentials (existing behavior preserved)", () => {
  withEnv({ DUNE_ENV: "dev", DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({ provider: "resend" });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: outside dev, a misconfigured live provider still falls back to console (existing behavior preserved)", () => {
  withEnv({ DUNE_ENV: undefined, DUNE_EMAIL_ALLOW_DEV_SEND: undefined }, () => {
    const provider = createEmailProvider({ provider: "resend" });
    assertInstanceOf(provider, ConsoleEmailProvider);
  });
});

Deno.test("createEmailProvider: DUNE_EMAIL_ALLOW_DEV_SEND alone (no DUNE_ENV=dev) has no effect outside dev", () => {
  withEnv({ DUNE_ENV: undefined, DUNE_EMAIL_ALLOW_DEV_SEND: "1" }, () => {
    const provider = createEmailProvider(resendConfig);
    assertInstanceOf(provider, ResendEmailProvider);
  });
});
