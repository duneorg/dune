/**
 * Public API handlers — no admin auth required.
 *
 * Routes handled here:
 *   POST /api/contact              — Legacy contact form submission
 *   GET  /api/forms/:name          — Blueprint-driven form schema (JSON)
 *   POST /api/forms/:name          — Blueprint-driven form submission
 *   POST /api/webhook/incoming     — Token-authenticated incoming webhook
 */

import type { AdminContext } from "./context.ts";
import { sendSubmissionEmail } from "./email.ts";
import { sendWebhookNotification } from "./webhook.ts";
import { loadForm } from "../forms/loader.ts";
import { validateFormSubmission } from "../forms/validator.ts";
import { checkUpload } from "../security/uploads.ts";
import { checkBodySize } from "../security/body-limit.ts";
import { RateLimiter } from "../security/rate-limit.ts";
import { encodeHex } from "@std/encoding/hex";
import type { SubmissionFile } from "./submissions.ts";
import type { WebhookNotificationConfig } from "../config/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function serverError(err: unknown): Response {
  console.error("[dune public-api]", err);
  // Never reflect internal error strings on the public, unauthenticated API.
  return json({ error: "Internal server error" }, 500);
}

// Hard ceiling on a single form submission body (multipart or urlencoded).
// Mirrors the per-file (10 MB) × per-submission (5 files) budget plus a small
// allowance for boundaries, headers, and non-file fields.
const MAX_SUBMISSION_BYTES = 55 * 1024 * 1024;

// Webhook bodies are always small JSON envelopes — 1 MiB is generous and
// shuts down trivially-large unauthenticated POSTs before req.json() runs.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

// Rate limiter: 5 submissions per IP per minute (shared across contact + form routes)
const contactRateLimiter = new RateLimiter(5, 60 * 1000);

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /api/forms/:name — return the form schema as JSON. */
export async function handleFormSchema(ctx: AdminContext, formName: string): Promise<Response> {
  const form = await loadForm(ctx.storage, "forms", formName);
  if (!form) {
    return json({ error: `Form "${formName}" not found` }, 404);
  }
  // Return the public schema — omit internal server-side config (emails, webhooks)
  return json({
    name: formName,
    title: form.title,
    success_url: form.success_url ?? "/",
    fields: form.fields,
    // Expose honeypot field name so the front-end can render the hidden input
    honeypot: form.honeypot ?? ctx.config.admin?.honeypot ?? "_hp",
  });
}

/** POST /api/forms/:name — validate and store a blueprint-driven form submission. */
export async function handleFormSubmission(ctx: AdminContext, req: Request, formName: string): Promise<Response> {
  const { storage, submissions, config } = ctx;

  if (!submissions) {
    return json({ error: "Submissions not enabled" }, 501);
  }

  const form = await loadForm(storage, "forms", formName);
  if (!form) {
    return json({ error: `Form "${formName}" not found` }, 404);
  }

  try {
    // Rate limit by IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? req.headers.get("x-real-ip")
      ?? "unknown";
    if (!contactRateLimiter.check(ip)) {
      const retryAfter = contactRateLimiter.retryAfter(ip);
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
      });
    }

    // Parse body
    const contentType = req.headers.get("content-type") ?? "";
    const multiFields: Record<string, string[]> = {};
    const uploadedFiles: Array<{ key: string; file: File }> = [];

    if (contentType.includes("application/json")) {
      const body = await req.json();
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string") multiFields[k] = [v];
        else if (Array.isArray(v)) multiFields[k] = v.filter((x) => typeof x === "string");
      }
    } else {
      const tooLarge = checkBodySize(req, MAX_SUBMISSION_BYTES);
      if (tooLarge) return tooLarge;
      const formData = await req.formData();
      for (const [k, v] of formData.entries()) {
        if (typeof v === "string") {
          (multiFields[k] ??= []).push(v);
        } else if (v instanceof File && v.size > 0) {
          uploadedFiles.push({ key: k, file: v });
        }
      }
    }

    // Collapse multi-value fields to comma-joined strings
    let fields: Record<string, string> = {};
    for (const [k, vs] of Object.entries(multiFields)) {
      fields[k] = vs.join(", ");
    }

    // Honeypot anti-spam
    const honeypotField = form.honeypot ?? config.admin?.honeypot ?? "_hp";
    if (fields[honeypotField]) {
      const acceptsJson = req.headers.get("accept")?.includes("application/json");
      if (acceptsJson) return json({ ok: true });
      return new Response(null, { status: 302, headers: { Location: form.success_url ?? "/" } });
    }
    delete fields[honeypotField];

    // Schema validation
    const validationErrors = validateFormSubmission(form, fields);
    if (validationErrors.length > 0) {
      const acceptsJson = req.headers.get("accept")?.includes("application/json");
      if (acceptsJson) {
        return json({ error: "Validation failed", errors: validationErrors }, 422);
      }
      // For regular form POST, redirect back with error indicator
      const requestOrigin = new URL(req.url).origin;
      const referer = req.headers.get("referer");
      let redirectPath = "/";
      if (referer) {
        try {
          const u = new URL(referer);
          if (u.origin === requestOrigin) {
            u.searchParams.set("form_error", "1");
            redirectPath = u.pathname + u.search;
          }
        } catch { /* bad referer */ }
      }
      return new Response(null, { status: 302, headers: { Location: redirectPath } });
    }

    // File uploads
    const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
    const storedFiles: SubmissionFile[] = [];
    if (uploadedFiles.length > 0) {
      const dataDir = config.admin?.dataDir ?? "data";
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      const MAX_FILES = 5;
      for (const { file } of uploadedFiles.slice(0, MAX_FILES)) {
        if (file.size > MAX_FILE_SIZE) continue;
        const safeName = file.name
          .replace(/[/\\:*?"<>|]/g, "_")
          .replace(/\s+/g, "_")
          .replace(/_{2,}/g, "_")
          .slice(0, 200);
        if (!safeName) continue;
        const check = checkUpload(safeName);
        if (!check.ok) continue;
        const storagePath = `${dataDir}/uploads/${formName}/${submissionId}/${safeName}`;
        await storage.write(storagePath, new Uint8Array(await file.arrayBuffer()));
        storedFiles.push({
          name: safeName,
          contentType: check.contentType,
          size: file.size,
          storagePath,
        });
      }
    }

    const submission = await submissions.create(formName, fields, {
      ip: ip === "unknown" ? undefined : ip,
      language: req.headers.get("accept-language") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    }, { id: submissionId, files: storedFiles });

    // Notifications — use global SMTP/webhook config as the base; per-form
    // overrides only replace the destination (to address / webhook URL).
    const globalNotif = config.admin?.notifications;
    if (globalNotif?.email) {
      // Per-form email override replaces the `to` address; SMTP credentials stay global.
      const emailCfg = form.notifications?.email
        ? { ...globalNotif.email, to: form.notifications.email }
        : globalNotif.email;
      sendSubmissionEmail(emailCfg, submission)
        .catch((err: Error) => console.error(`[dune] Email notification failed: ${err.message}`));
    }
    if (globalNotif?.webhook || form.notifications?.webhook) {
      // Per-form webhook override replaces the URL; keep global secret/headers if any.
      const webhookCfg = form.notifications?.webhook
        ? { ...(globalNotif?.webhook ?? {}), url: form.notifications.webhook } as WebhookNotificationConfig
        : globalNotif!.webhook!;
      sendWebhookNotification(webhookCfg, submission)
        .catch((err: Error) => console.error(`[dune] Webhook notification failed: ${err.message}`));
    }

    const acceptsJson = req.headers.get("accept")?.includes("application/json");
    if (acceptsJson) return json({ ok: true });

    const successUrl = form.success_url ?? "/";
    return new Response(null, { status: 302, headers: { Location: successUrl } });
  } catch (err) {
    return serverError(err);
  }
}

// ── Incoming webhook handler ──────────────────────────────────────────────────
// POST /api/webhook/incoming
// Body: { token: string } — optional, token may also be in Authorization header
//   Bearer <token>  OR  body.token
// Matches token against config.admin.incoming_webhooks entries.
// Token values starting with "$" are expanded from environment variables.
// On match, dispatches the permitted actions requested in the body.
export async function handleIncomingWebhook(ctx: AdminContext, req: Request): Promise<Response> {
  const { config, engine, auditLogger, imageCache } = ctx;

  const incomingWebhooks = config.admin?.incoming_webhooks;
  if (!incomingWebhooks || incomingWebhooks.length === 0) {
    return json({ error: "Incoming webhooks not configured" }, 501);
  }

  // Cap body size before parsing JSON to prevent unauthenticated memory DoS:
  // req.json() buffers the whole body before validating the token below.
  const tooLarge = checkBodySize(req, MAX_WEBHOOK_BYTES);
  if (tooLarge) return tooLarge;

  // Extract token from Authorization header (Bearer) or JSON body
  let token: string | null = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // body optional — token may be in header only
  }

  if (!token && typeof body.token === "string") {
    token = body.token;
  }

  if (!token) {
    return json({ error: "Missing token" }, 401);
  }

  // Find a matching webhook config entry (expand $ENV_VAR tokens)
  const expandToken = (t: string): string => {
    if (t.startsWith("$")) {
      return Deno.env.get(t.slice(1)) ?? t;
    }
    return t;
  };

  // Compare in constant time: equal-length byte comparison prevents an
  // attacker from progressively recovering the configured token by
  // measuring response timing.
  const tokenBytes = new TextEncoder().encode(token);
  const matched = incomingWebhooks.find((wh) => {
    const candidate = new TextEncoder().encode(expandToken(wh.token));
    if (candidate.byteLength !== tokenBytes.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < candidate.byteLength; i++) {
      diff |= candidate[i] ^ tokenBytes[i];
    }
    return diff === 0;
  });

  if (!matched) {
    return json({ error: "Invalid token" }, 401);
  }

  // Determine which actions to run — request body may specify a subset
  let requestedActions: string[];
  if (Array.isArray(body.actions)) {
    requestedActions = body.actions.filter(
      (a) => typeof a === "string" && matched.actions.includes(a as "rebuild" | "purge-cache"),
    );
  } else {
    // No specific action requested — run all permitted actions
    requestedActions = matched.actions as string[];
  }

  if (requestedActions.length === 0) {
    return json({ error: "No permitted actions match the request" }, 400);
  }

  const executed: string[] = [];

  for (const action of requestedActions) {
    if (action === "rebuild") {
      // Fire-and-forget — don't block the response
      engine.rebuild().catch((err: unknown) => {
        console.error("[dune] incoming webhook rebuild error:", err);
      });
      void auditLogger?.log({
        event: "system.rebuild",
        actor: null,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null,
        userAgent: req.headers.get("user-agent"),
        target: { type: "system" },
        detail: {},
        outcome: "success",
      }).catch(() => {});
      executed.push("rebuild");
    } else if (action === "purge-cache") {
      if (imageCache) {
        await imageCache.clear();
      }
      void auditLogger?.log({
        event: "system.cache_purge",
        actor: null,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null,
        userAgent: req.headers.get("user-agent"),
        target: { type: "system" },
        detail: {},
        outcome: "success",
      }).catch(() => {});
      executed.push("purge-cache");
    }
  }

  return json({ ok: true, executed });
}

// ── Contact form submission handler (public) ──────────────────────────────────

export async function handleContactSubmission(ctx: AdminContext, req: Request): Promise<Response> {
  const { storage, submissions, config } = ctx;

  if (!submissions) {
    return json({ error: "Submissions not enabled" }, 501);
  }
  try {
    // Rate limit by IP: 5 submissions per minute
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? req.headers.get("x-real-ip")
      ?? "unknown";
    if (!contactRateLimiter.check(ip)) {
      const retryAfter = contactRateLimiter.retryAfter(ip);
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      });
    }

    const contentType = req.headers.get("content-type") ?? "";
    const multiFields: Record<string, string[]> = {};
    const uploadedFiles: Array<{ key: string; file: File }> = [];

    if (contentType.includes("application/json")) {
      const body = await req.json();
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string") multiFields[k] = [v];
        else if (Array.isArray(v)) multiFields[k] = v.filter((x) => typeof x === "string");
      }
    } else {
      // application/x-www-form-urlencoded or multipart/form-data
      const tooLarge = checkBodySize(req, MAX_SUBMISSION_BYTES);
      if (tooLarge) return tooLarge;
      const formData = await req.formData();
      for (const [k, v] of formData.entries()) {
        if (typeof v === "string") {
          (multiFields[k] ??= []).push(v);
        } else if (v instanceof File && v.size > 0) {
          uploadedFiles.push({ key: k, file: v });
        }
      }
    }

    // Collapse multi-value fields to comma-joined strings
    let fields: Record<string, string> = {};
    for (const [k, vs] of Object.entries(multiFields)) {
      fields[k] = vs.join(", ");
    }

    // ── Honeypot anti-spam ────────────────────────────────────────────────
    // If the configured honeypot field is present and non-empty, a bot filled
    // it in. Silently accept (so bots get no useful signal) but don't save.
    const honeypotField = config.admin?.honeypot ?? "_hp";
    if (fields[honeypotField]) {
      // Looks like a bot submission — return success without saving
      const acceptsJson = req.headers.get("accept")?.includes("application/json");
      if (acceptsJson) return json({ ok: true });
      return new Response(null, { status: 302, headers: { "Location": "/" } });
    }
    delete fields[honeypotField]; // remove the empty honeypot field from data

    // Basic required field validation
    if (!fields.name && !fields.email) {
      return json({ error: "Missing required fields" }, 400);
    }

    const language = req.headers.get("accept-language") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    // Use form_name field if provided (allows multiple forms), otherwise default to "contact".
    // Validate form_name: it becomes a filesystem directory name, so restrict to safe chars.
    // Only alphanumeric, hyphens, and underscores — no slashes, dots, or special chars.
    const rawFormName = fields.form_name ?? "contact";
    delete fields.form_name;
    const formName = /^[a-zA-Z0-9_-]{1,64}$/.test(rawFormName) ? rawFormName : "contact";

    // ── File uploads ──────────────────────────────────────────────────────
    // Pre-generate submission ID so we can store files before creating the record.
    const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
    const storedFiles: SubmissionFile[] = [];

    if (uploadedFiles.length > 0) {
      const dataDir = config.admin?.dataDir ?? "data";
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
      const MAX_FILES = 5;

      for (const { key: _key, file } of uploadedFiles.slice(0, MAX_FILES)) {
        if (file.size > MAX_FILE_SIZE) continue; // silently skip oversized files

        // Sanitise filename: strip path separators, collapse whitespace
        const safeName = file.name
          .replace(/[/\\:*?"<>|]/g, "_")
          .replace(/\s+/g, "_")
          .replace(/_{2,}/g, "_")
          .slice(0, 200);
        if (!safeName) continue;

        const check = checkUpload(safeName);
        if (!check.ok) continue; // silently skip disallowed extensions

        const storagePath = `${dataDir}/uploads/${formName}/${submissionId}/${safeName}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await storage.write(storagePath, bytes);

        storedFiles.push({
          name: safeName,
          contentType: check.contentType,
          size: file.size,
          storagePath,
        });
      }
    }

    const submission = await submissions.create(formName, fields, {
      ip: ip === "unknown" ? undefined : ip,
      language,
      userAgent,
    }, { id: submissionId, files: storedFiles });

    // ── Notifications (fire-and-forget) ───────────────────────────────────
    const notifCfg = config.admin?.notifications;
    if (notifCfg) {
      if (notifCfg.email) {
        sendSubmissionEmail(notifCfg.email, submission)
          .catch((err: Error) => console.error(`[dune] Email notification failed: ${err.message}`));
      }
      if (notifCfg.webhook) {
        sendWebhookNotification(notifCfg.webhook, submission)
          .catch((err: Error) => console.error(`[dune] Webhook notification failed: ${err.message}`));
      }
    }

    // Support both JSON and form POST responses
    const acceptsJson = req.headers.get("accept")?.includes("application/json");
    if (acceptsJson) {
      return json({ ok: true });
    }

    // Redirect back (form POST) — validate Referer is same-origin to prevent open redirect.
    // If Referer is missing, cross-origin, or unparseable, fall back to "/".
    // Behind a reverse proxy req.url has the internal origin (http://localhost:PORT),
    // so also accept the public origin derived from Host + X-Forwarded-Proto headers.
    const requestOrigin = new URL(req.url).origin;
    const host = req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const publicOrigin = host ? `${proto}://${host}` : null;
    const refererHeader = req.headers.get("referer");
    let redirectPath = "/";
    if (refererHeader) {
      try {
        const refererUrl = new URL(refererHeader);
        if (refererUrl.origin === requestOrigin || (publicOrigin && refererUrl.origin === publicOrigin)) {
          // Safe: same-origin — keep the path+query, append ?submitted=1
          refererUrl.searchParams.set("submitted", "1");
          redirectPath = refererUrl.pathname + refererUrl.search;
        }
      } catch {
        // Unparseable Referer — fall back to "/"
      }
    }
    return new Response(null, {
      status: 302,
      headers: { "Location": redirectPath },
    });
  } catch (err) {
    return serverError(err);
  }
}
