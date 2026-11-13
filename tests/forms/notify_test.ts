import { assertEquals, assertStringIncludes } from "@std/assert";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import { resolveFormsConfig } from "../../src/forms/config.ts";
import { createSubmissionNotifier, renderSubmissionEmail } from "../../src/forms/notify.ts";
import type { Submission } from "../../src/forms/submissions.ts";
import type { EmailMessage } from "../../src/email/types.ts";

const submission: Submission = {
  id: "abc123",
  form: "contact",
  receivedAt: Date.UTC(2026, 10, 3),
  status: "new",
  fields: { name: "<b>Ann</b>", message: "hi" },
  meta: {},
};

Deno.test("email rendering: subject placeholder, escaped HTML, plain-text fields", () => {
  const r = renderSubmissionEmail(submission, "Inbox: {form}");
  assertEquals(r.subject, "Inbox: contact");
  assertStringIncludes(r.html, "&lt;b&gt;Ann&lt;/b&gt;");
  assertEquals(r.html.includes("<b>Ann</b>"), false);
  assertStringIncludes(r.text, "name: <b>Ann</b>");
  assertEquals(renderSubmissionEmail(submission).subject, "New contact submission");
});

Deno.test("notifier: email goes through the provider with site.email.from; per-form `to` wins", async () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
  config.site.email = { provider: "console", from: "site@example.com" };
  config.site.forms = { notifications: { email: { to: "default@example.com" } } };
  const sent: EmailMessage[] = [];
  const notifier = createSubmissionNotifier(config, resolveFormsConfig(config), {
    emailProvider: { send: (m) => (sent.push(m), Promise.resolve()) },
  });
  notifier.dispatch(submission);
  notifier.dispatch(submission, { emailTo: "sales@example.com" });
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(sent.map((m) => m.to), ["default@example.com", "sales@example.com"]);
  assertEquals(sent[0].from, "site@example.com");
});

Deno.test("notifier: webhook override replaces the URL but keeps the secret", async () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
  config.site.forms = { notifications: { webhook: { url: "https://a.example/h", secret: "s" } } };
  const calls: Array<{ url: string; secret?: string }> = [];
  const notifier = createSubmissionNotifier(config, resolveFormsConfig(config), {
    sendWebhook: (cfg) => (calls.push({ url: cfg.url, secret: cfg.secret }), Promise.resolve()),
  });
  notifier.dispatch(submission, { webhookUrl: "https://b.example/h" });
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(calls, [{ url: "https://b.example/h", secret: "s" }]);
});

Deno.test("notifier: a failing channel never throws to the submitter", async () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
  config.site.forms = {
    notifications: { email: { to: "a@b.c" }, webhook: { url: "https://a.example/h" } },
  };
  const notifier = createSubmissionNotifier(config, resolveFormsConfig(config), {
    emailProvider: { send: () => Promise.reject(new Error("smtp down")) },
    sendWebhook: () => Promise.reject(new Error("502")),
  });
  notifier.dispatch(submission);
  await new Promise((r) => setTimeout(r, 20)); // would surface as an unhandled rejection
});
