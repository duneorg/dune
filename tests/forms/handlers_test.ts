/**
 * Tests for the public form and incoming-webhook handlers (run in core, no
 * admin plugin). This is unauthenticated surface: body caps, honeypot,
 * disabled forms, redirects, token checks, rate limits and hook firing.
 */

import { assertEquals } from "@std/assert";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import { createSubmissionManager } from "../../src/forms/submissions.ts";
import {
  createSubmissionRateLimiter,
  type FormsRuntime,
  handleContactSubmission,
  handleFormSchema,
  handleFormSubmission,
  handleIncomingWebhook,
} from "../../src/forms/handlers.ts";
import { resolveFormsConfig } from "../../src/forms/config.ts";
import type { Submission } from "../../src/forms/submissions.ts";
import type { HookEvent, HookRegistry } from "../../src/hooks/types.ts";

const FORM = [
  "title: Contact",
  "success_url: /thanks",
  "fields:",
  "  name: { type: text, label: Name, required: true }",
  "  message: { type: textarea, label: Message, required: true }",
].join("\n");

interface Harness {
  rt: FormsRuntime;
  storage: MemoryStorageAdapter;
  fired: Array<{ event: HookEvent; data: unknown }>;
  notified: Array<{ submission: Submission; overrides: unknown }>;
  rebuilds: number;
  purges: number;
}

function harness(
  patch: (config: DuneConfig) => void = () => {},
  forms: Record<string, string> = { contact: FORM },
): Harness {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
  patch(config);
  const storage = new MemoryStorageAdapter();
  for (const [name, yaml] of Object.entries(forms)) storage.set(`forms/${name}.yaml`, yaml);
  const h: Harness = { fired: [], notified: [], rebuilds: 0, purges: 0 } as unknown as Harness;
  h.fired = [];
  h.notified = [];
  h.rebuilds = 0;
  h.purges = 0;
  h.storage = storage;
  const resolved = resolveFormsConfig(config);
  h.rt = {
    storage,
    config,
    forms: resolved,
    submissions: createSubmissionManager({ storage, submissionsDir: `${resolved.dataDir}/submissions` }),
    notifier: { dispatch: (submission, overrides) => void h.notified.push({ submission, overrides }) },
    hooks: {
      fire: (event: HookEvent, data: unknown) => {
        h.fired.push({ event, data });
        return Promise.resolve(data);
      },
    } as unknown as HookRegistry,
    rateLimiter: createSubmissionRateLimiter(),
    engine: { rebuild: () => (h.rebuilds++, Promise.resolve()) },
    imageCache: { clear: () => void h.purges++ },
  };
  return h;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", body, headers });
const postJson = (path: string, data: unknown) => post(path, JSON.stringify(data), JSON_HEADERS);

// ── Form schema ─────────────────────────────────────────────────────────────

Deno.test("schema: served for an enabled form, 404 for unknown or disabled (same response)", async () => {
  const h = harness((_c) => {}, {
    contact: FORM,
    paused: `${FORM}\nenabled: false`,
  });
  const ok = await handleFormSchema(h.rt, "contact");
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).honeypot, "_hp");

  const missing = await handleFormSchema(h.rt, "nope");
  const paused = await handleFormSchema(h.rt, "paused");
  assertEquals(missing.status, 404);
  assertEquals(paused.status, 404);
  assertEquals((await paused.text()).replace("paused", "X"), (await missing.text()).replace("nope", "X"));
});

Deno.test("schema: honeypot name follows forms.honeypot", async () => {
  const h = harness((c) => (c.site.forms = { honeypot: "website" }));
  assertEquals((await (await handleFormSchema(h.rt, "contact")).json()).honeypot, "website");
});

// ── Submissions ─────────────────────────────────────────────────────────────

Deno.test("submit: stores under <data_dir>/submissions/<form>, notifies, fires onFormSubmit", async () => {
  const h = harness((c) => (c.system.data_dir = "records"));
  const res = await handleFormSubmission(h.rt, postJson("/api/forms/contact", { name: "A", message: "hi" }), "contact");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  assertEquals((await h.rt.submissions.list("contact")).length, 1);
  assertEquals((await h.storage.list("records/submissions/contact")).length, 1);
  assertEquals(h.notified.length, 1);
  assertEquals(h.fired.map((f) => f.event), ["onFormSubmit"]);
  assertEquals((h.fired[0].data as { form: string }).form, "contact");
});

Deno.test("submit: per-form notification overrides are passed through", async () => {
  const h = harness(undefined, {
    contact: `${FORM}\nnotifications:\n  email: sales@example.com\n  webhook: https://hooks.example.com/x`,
  });
  await handleFormSubmission(h.rt, postJson("/api/forms/contact", { name: "A", message: "hi" }), "contact");
  assertEquals(h.notified[0].overrides, { emailTo: "sales@example.com", webhookUrl: "https://hooks.example.com/x" });
});

Deno.test("submit: form-encoded post redirects to a same-origin success_url", async () => {
  const h = harness();
  const res = await handleFormSubmission(
    h.rt,
    post("/api/forms/contact", new URLSearchParams({ name: "A", message: "hi" })),
    "contact",
  );
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/thanks");
});

Deno.test("submit: a cross-origin success_url is not followed (open redirect)", async () => {
  const h = harness(undefined, { contact: FORM.replace("/thanks", "https://evil.example/phish") });
  const res = await handleFormSubmission(
    h.rt,
    post("/api/forms/contact", new URLSearchParams({ name: "A", message: "hi" })),
    "contact",
  );
  assertEquals(res.headers.get("location"), "/");
});

Deno.test("submit: honeypot is swallowed with a success response and not stored", async () => {
  const h = harness();
  const res = await handleFormSubmission(
    h.rt,
    postJson("/api/forms/contact", { name: "A", message: "hi", _hp: "bot" }),
    "contact",
  );
  assertEquals(res.status, 200);
  assertEquals((await h.rt.submissions.list("contact")).length, 0);
  assertEquals(h.fired.length, 0);
  assertEquals(h.notified.length, 0);
});

Deno.test("submit: invalid input is a 422 for JSON clients and stores nothing", async () => {
  const h = harness();
  const res = await handleFormSubmission(h.rt, postJson("/api/forms/contact", { name: "" }), "contact");
  assertEquals(res.status, 422);
  assertEquals((await h.rt.submissions.list("contact")).length, 0);
  assertEquals(h.fired.length, 0);
});

Deno.test("submit: unknown form is 404, disabled form is 403", async () => {
  const h = harness(undefined, { contact: FORM, paused: `${FORM}\nenabled: false` });
  assertEquals((await handleFormSubmission(h.rt, postJson("/x", {}), "nope")).status, 404);
  assertEquals((await handleFormSubmission(h.rt, postJson("/x", {}), "paused")).status, 403);
});

Deno.test("submit: a declared body over the cap is rejected before parsing (413)", async () => {
  const h = harness();
  const req = post("/api/forms/contact", "{}", { ...JSON_HEADERS, "content-length": String(60 * 1024 * 1024) });
  assertEquals((await handleFormSubmission(h.rt, req, "contact")).status, 413);
});

Deno.test("submit: the 6th submission from one client in a minute is a 429 with Retry-After", async () => {
  const h = harness();
  // Requests without a socket address share the "unknown" key, which the
  // limiter deliberately skips; trust the forwarded header to get a real key.
  h.rt.config.system.trusted_proxies = true;
  const send = () =>
    handleFormSubmission(
      h.rt,
      post("/api/forms/contact", JSON.stringify({ name: "A", message: "hi" }), {
        ...JSON_HEADERS,
        "x-forwarded-for": "203.0.113.9",
      }),
      "contact",
    );
  for (let i = 0; i < 5; i++) assertEquals((await send()).status, 200);
  const limited = await send();
  assertEquals(limited.status, 429);
  assertEquals(Number(limited.headers.get("retry-after")) > 0, true);
});

Deno.test("submit: each app has its own rate limiter", async () => {
  const a = harness();
  const b = harness();
  for (const h of [a, b]) h.rt.config.system.trusted_proxies = true;
  const send = (h: Harness) =>
    handleFormSubmission(
      h.rt,
      post("/api/forms/contact", JSON.stringify({ name: "A", message: "hi" }), {
        ...JSON_HEADERS,
        "x-forwarded-for": "203.0.113.9",
      }),
      "contact",
    );
  for (let i = 0; i < 5; i++) await send(a);
  assertEquals((await send(a)).status, 429);
  assertEquals((await send(b)).status, 200);
});

Deno.test("submit: uploads with disallowed extensions are skipped, allowed ones stored", async () => {
  const h = harness();
  const fd = new FormData();
  fd.set("name", "A");
  fd.set("message", "hi");
  fd.append("a", new File(["x"], "ok.pdf", { type: "application/pdf" }));
  fd.append("b", new File(["x"], "run.exe", { type: "application/octet-stream" }));
  const res = await handleFormSubmission(h.rt, post("/api/forms/contact", fd, { accept: "application/json" }), "contact");
  assertEquals(res.status, 200);
  const [sub] = await h.rt.submissions.list("contact");
  assertEquals(sub.files?.map((f) => f.name), ["ok.pdf"]);
});

// ── Legacy contact route ────────────────────────────────────────────────────

Deno.test("contact (deprecated): stores under form_name, sanitising it", async () => {
  const h = harness();
  const ok = await handleContactSubmission(h.rt, postJson("/api/contact", { name: "A", email: "a@b.c", form_name: "sales" }));
  assertEquals(ok.status, 200);
  assertEquals((await h.rt.submissions.list("sales")).length, 1);

  await handleContactSubmission(h.rt, postJson("/api/contact", { name: "A", form_name: "../../etc" }));
  assertEquals((await h.rt.submissions.list("contact")).length, 1);
});

Deno.test("contact (deprecated): needs a name or an email", async () => {
  const h = harness();
  assertEquals((await handleContactSubmission(h.rt, postJson("/api/contact", { message: "x" }))).status, 400);
});

// ── Incoming webhook ────────────────────────────────────────────────────────

const hook = (token: string | null, body: unknown = {}) =>
  post("/api/webhook/incoming", JSON.stringify(body), {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

Deno.test("webhook: 501 when none configured", async () => {
  assertEquals((await handleIncomingWebhook(harness().rt, hook("x"))).status, 501);
});

Deno.test("webhook: 401 for a missing or wrong token", async () => {
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "secret", actions: ["rebuild"] }] }));
  assertEquals((await handleIncomingWebhook(h.rt, hook(null))).status, 401);
  assertEquals((await handleIncomingWebhook(h.rt, hook("secre"))).status, 401);
  assertEquals((await handleIncomingWebhook(h.rt, hook("secret!"))).status, 401);
  assertEquals(h.rebuilds, 0);
});

Deno.test("webhook: token may come in the body; runs permitted actions and fires onSystemAction", async () => {
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "secret", actions: ["rebuild", "purge-cache"] }] }));
  const res = await handleIncomingWebhook(h.rt, hook(null, { token: "secret" }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).executed, ["rebuild", "purge-cache"]);
  assertEquals(h.rebuilds, 1);
  assertEquals(h.purges, 1);
  assertEquals(h.fired.map((f) => (f.data as { action: string }).action), ["rebuild", "purge-cache"]);
  assertEquals(h.fired.every((f) => f.event === "onSystemAction"), true);
});

Deno.test("webhook: a request can only narrow, never widen, the token's actions", async () => {
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "secret", actions: ["purge-cache"] }] }));
  const res = await handleIncomingWebhook(h.rt, hook("secret", { actions: ["rebuild"] }));
  assertEquals(res.status, 400);
  assertEquals(h.rebuilds, 0);
});

Deno.test("webhook: $ENV tokens are expanded", async () => {
  Deno.env.set("DUNE_TEST_WEBHOOK_TOKEN", "from-env");
  try {
    const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "$DUNE_TEST_WEBHOOK_TOKEN", actions: ["rebuild"] }] }));
    assertEquals((await handleIncomingWebhook(h.rt, hook("from-env"))).status, 200);
    assertEquals((await handleIncomingWebhook(h.rt, hook("$DUNE_TEST_WEBHOOK_TOKEN"))).status, 401);
  } finally {
    Deno.env.delete("DUNE_TEST_WEBHOOK_TOKEN");
  }
});

Deno.test("webhook: a $ENV token whose variable is unset matches nothing, not its own name", async () => {
  Deno.env.delete("DUNE_TEST_WEBHOOK_UNSET");
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "$DUNE_TEST_WEBHOOK_UNSET", actions: ["rebuild"] }] }));
  assertEquals((await handleIncomingWebhook(h.rt, hook("$DUNE_TEST_WEBHOOK_UNSET"))).status, 401);
  assertEquals((await handleIncomingWebhook(h.rt, hook("DUNE_TEST_WEBHOOK_UNSET"))).status, 401);
  Deno.env.set("DUNE_TEST_WEBHOOK_UNSET", "");
  try {
    // Set but empty is just as unusable.
    assertEquals((await handleIncomingWebhook(h.rt, hook("$DUNE_TEST_WEBHOOK_UNSET"))).status, 401);
  } finally {
    Deno.env.delete("DUNE_TEST_WEBHOOK_UNSET");
  }
});

Deno.test("webhook: an oversized body is rejected before parsing (413)", async () => {
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "t", actions: ["rebuild"] }] }));
  const req = post("/api/webhook/incoming", "{}", { "content-length": String(2 * 1024 * 1024) });
  assertEquals((await handleIncomingWebhook(h.rt, req)).status, 413);
});

Deno.test("webhook: a failing action is a fixed 500 that never leaks the error", async () => {
  const h = harness((c) => (c.system.webhooks = { incoming: [{ token: "t", actions: ["purge-cache"] }] }));
  h.rt.imageCache = { clear: () => Promise.reject(new Error("db password is hunter2")) };
  const res = await handleIncomingWebhook(h.rt, hook("t"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal server error" });
});
