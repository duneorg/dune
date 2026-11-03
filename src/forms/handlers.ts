/**
 * Public form and incoming-webhook handlers — no auth required.
 *
 *   POST /api/contact            — legacy contact form (deprecated: use /api/forms/contact)
 *   GET  /api/forms/:name        — form schema (JSON)
 *   POST /api/forms/:name        — form submission
 *   POST /api/webhook/incoming   — token-authenticated action trigger
 *
 * These run in core so a site works without an admin plugin. Handlers take a
 * {@link FormsRuntime} bound to one app instance, so multisite tenants never
 * share a rate limiter or submission store.
 *
 * @module
 */

import { encodeHex } from "@std/encoding/hex";
import { loadForm } from "./loader.ts";
import { validateFormSubmission } from "./validator.ts";
import { checkUpload } from "../security/uploads.ts";
import { checkBodySize } from "../security/body-limit.ts";
import { clientIp, RateLimiter } from "../security/rate-limit.ts";
import { timingSafeEqualStrings } from "../security/timing-safe.ts";
import { logger } from "../core/logger.ts";
import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { SubmissionFile, SubmissionManager } from "./submissions.ts";
import type { ResolvedFormsConfig } from "./config.ts";
import type { SubmissionNotifier } from "./notify.ts";

/** Everything the public handlers need, bound to one app instance. */
export interface FormsRuntime {
  storage: StorageAdapter;
  config: DuneConfig;
  forms: ResolvedFormsConfig;
  submissions: SubmissionManager;
  notifier: SubmissionNotifier;
  hooks: HookRegistry;
  /** 5 submissions per IP per minute, shared by the contact and form routes. */
  rateLimiter: RateLimiter;
  engine: { rebuild(): Promise<void> };
  imageCache: { clear(): Promise<void> | void };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Fixed 500 for the unauthenticated surface: the error's own message is
 * logged but never returned, so internal strings can't leak to callers.
 */
function serverError(err: unknown): Response {
  logger.error("forms.handler_failed", {
    reason: err instanceof Error ? err.message : String(err),
  });
  return json({ error: "Internal server error" }, 500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Same-origin path only — form.success_url is otherwise an open redirect. */
function safeRedirectPath(target: string, req: Request): string {
  if (
    typeof target !== "string" || target.length === 0 || target.length > 2048
  ) {
    return "/";
  }
  if (target.includes("\0") || target.includes("\r") || target.includes("\n")) {
    return "/";
  }
  if (target.startsWith("//") || target.startsWith("\\\\")) return "/";
  try {
    const requestUrl = new URL(req.url);
    const parsed = new URL(target, requestUrl);
    if (parsed.origin !== requestUrl.origin) return "/";
    if (!parsed.pathname.startsWith("/")) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

// Hard ceiling on a single form submission body (multipart or urlencoded).
// Mirrors the per-file (10 MB) × per-submission (5 files) budget plus a small
// allowance for boundaries, headers, and non-file fields.
const MAX_SUBMISSION_BYTES = 55 * 1024 * 1024;

// Webhook bodies are always small JSON envelopes — 1 MiB is generous and
// shuts down trivially-large unauthenticated POSTs before req.json() runs.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

/** A fresh limiter for one app: 5 submissions per IP per minute. */
export function createSubmissionRateLimiter(): RateLimiter {
  return new RateLimiter(5, 60 * 1000);
}

// ── Shared submission pipeline (Q-1, Aug 2026 quality audit) ──────────────────
//
// handleFormSubmission and handleContactSubmission previously duplicated the
// rate-limit → body-size → parse → field-collapse → upload-storage pipeline
// (~150 lines each). Bugs fixed in one copy could silently miss the other —
// exactly how MED-19 (JSON bypassing the body-size cap) needed two fixes.
// The handlers below keep only their unique validation and response logic.

interface ParsedSubmission {
  /** Multi-value fields collapsed to comma-joined strings. */
  fields: Record<string, string>;
  uploadedFiles: Array<{ key: string; file: File }>;
}

/**
 * Rate-limit by IP, cap body size, and parse JSON/form-data bodies into
 * collapsed fields + uploaded files. Returns a ready-made Response
 * (429 / 413 / parse error) that the caller must return as-is.
 */
async function guardAndParseSubmission(
  req: Request,
  rt: FormsRuntime,
): Promise<ParsedSubmission | Response> {
  // Rate limit by IP: 5 submissions per minute. Honor X-Forwarded-For
  // only when system.trusted_proxies is set (otherwise clients can spoof).
  const trustForwardedFor = rt.config.system?.trusted_proxies === true;
  const ip = clientIp(req, { trustForwardedFor });
  if (!rt.rateLimiter.check(ip)) {
    const retryAfter = rt.rateLimiter.retryAfter(ip);
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    });
  }

  // Body-size cap applies regardless of content-type — JSON used to bypass
  // this guard and accept arbitrarily large payloads (MED-19, CWE-400).
  const tooLarge = checkBodySize(req, MAX_SUBMISSION_BYTES);
  if (tooLarge) return tooLarge;

  const contentType = req.headers.get("content-type") ?? "";
  const multiFields: Record<string, string[]> = {};
  const uploadedFiles: Array<{ key: string; file: File }> = [];

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === "string") multiFields[k] = [v];
      else if (Array.isArray(v)) {
        multiFields[k] = v.filter((x) => typeof x === "string");
      }
    }
  } else {
    // application/x-www-form-urlencoded or multipart/form-data
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
  const fields: Record<string, string> = {};
  for (const [k, vs] of Object.entries(multiFields)) {
    fields[k] = vs.join(", ");
  }

  return { fields, uploadedFiles };
}

let warnedContactDeprecated = false;

const MAX_STORED_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES_PER_SUBMISSION = 5;

/** Sanitise a filename: strip path separators, collapse whitespace. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
}

/**
 * Persist accepted uploads under data/uploads/<form>/<submissionId>/.
 * Oversized files and disallowed extensions are silently skipped (bots get
 * no signal; legitimate submitters see their submission still recorded).
 */
async function storeUploads(
  storage: StorageAdapter,
  dataDir: string,
  formName: string,
  submissionId: string,
  uploadedFiles: ParsedSubmission["uploadedFiles"],
): Promise<SubmissionFile[]> {
  const storedFiles: SubmissionFile[] = [];
  for (const { file } of uploadedFiles.slice(0, MAX_FILES_PER_SUBMISSION)) {
    if (file.size > MAX_STORED_FILE_SIZE) continue;

    const safeName = sanitizeFilename(file.name);
    if (!safeName) continue;
    const check = checkUpload(safeName);
    if (!check.ok) continue; // silently skip disallowed extensions

    const storagePath =
      `${dataDir}/uploads/${formName}/${submissionId}/${safeName}`;
    await storage.write(storagePath, new Uint8Array(await file.arrayBuffer()));

    storedFiles.push({
      name: safeName,
      contentType: check.contentType,
      size: file.size,
      storagePath,
    });
  }
  return storedFiles;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /api/forms/:name — return the form schema as JSON. */
export async function handleFormSchema(
  ctx: FormsRuntime,
  formName: string,
): Promise<Response> {
  const form = await loadForm(ctx.storage, "forms", formName);
  // Disabled forms are indistinguishable from missing forms to the public
  // (MED-20): same 404 response so a public client can't enumerate the
  // server's "this form exists but is paused" state.
  if (!form || form.enabled === false) {
    return json({ error: `Form "${formName}" not found` }, 404);
  }
  // Return the public schema — omit internal server-side config (emails, webhooks)
  return json({
    name: formName,
    title: form.title,
    success_url: form.success_url ?? "/",
    fields: form.fields,
    // Expose honeypot field name so the front-end can render the hidden input
    honeypot: form.honeypot ?? ctx.forms.honeypot,
  });
}

/** POST /api/forms/:name — validate and store a blueprint-driven form submission. */
export async function handleFormSubmission(
  ctx: FormsRuntime,
  req: Request,
  formName: string,
): Promise<Response> {
  const { storage, submissions, config, forms } = ctx;

  const form = await loadForm(storage, "forms", formName);
  if (!form) {
    return json({ error: `Form "${formName}" not found` }, 404);
  }
  if (form.enabled === false) {
    // Form is paused (MED-20). Refuse the submission with a generic
    // 403 instead of 404 so legitimate authors who hit a disabled form
    // get a clearer signal in client logs.
    return json({ error: "Form is not currently accepting submissions" }, 403);
  }

  try {
    const parsed = await guardAndParseSubmission(req, ctx);
    if (parsed instanceof Response) return parsed;
    const { fields, uploadedFiles } = parsed;

    // Honeypot anti-spam
    const honeypotField = form.honeypot ?? forms.honeypot;
    if (fields[honeypotField]) {
      const acceptsJson = req.headers.get("accept")?.includes(
        "application/json",
      );
      if (acceptsJson) return json({ ok: true });
      return new Response(null, {
        status: 302,
        headers: { Location: form.success_url ?? "/" },
      });
    }
    delete fields[honeypotField];

    // Schema validation
    const validationErrors = validateFormSubmission(form, fields);
    if (validationErrors.length > 0) {
      const acceptsJson = req.headers.get("accept")?.includes(
        "application/json",
      );
      if (acceptsJson) {
        return json(
          { error: "Validation failed", errors: validationErrors },
          422,
        );
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
      return new Response(null, {
        status: 302,
        headers: { Location: redirectPath },
      });
    }

    // File uploads
    const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
    const storedFiles = await storeUploads(
      storage,
      forms.dataDir,
      formName,
      submissionId,
      uploadedFiles,
    );

    const submitterIp = clientIp(req, {
      trustForwardedFor: config.system?.trusted_proxies === true,
    });
    const submission = await submissions.create(formName, fields, {
      ip: submitterIp === "unknown" ? undefined : submitterIp,
      language: req.headers.get("accept-language") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    }, { id: submissionId, files: storedFiles });

    // Notifications — per-form overrides replace only the destination.
    ctx.notifier.dispatch(submission, {
      emailTo: form.notifications?.email,
      webhookUrl: form.notifications?.webhook,
    });
    await ctx.hooks.fire("onFormSubmit", { form: formName, submission });

    const acceptsJson = req.headers.get("accept")?.includes("application/json");
    if (acceptsJson) return json({ ok: true });

    const successUrl = safeRedirectPath(form.success_url ?? "/", req);
    return new Response(null, {
      status: 302,
      headers: { Location: successUrl },
    });
  } catch (err) {
    return serverError(err);
  }
}

// ── Incoming webhook handler ──────────────────────────────────────────────────
// POST /api/webhook/incoming
// Body: { token: string } — optional, token may also be in Authorization header
//   Bearer <token>  OR  body.token
// Matches token against the `webhooks.incoming` entries (system.yaml).
// Token values starting with "$" are expanded from environment variables.
// On match, dispatches the permitted actions requested in the body.
/**
 * Handle `POST /api/webhook/incoming` — validates the token and dispatches permitted actions.
 * Token may be in the `Authorization: Bearer` header or `body.token`.
 */
export async function handleIncomingWebhook(
  ctx: FormsRuntime,
  req: Request,
): Promise<Response> {
  const { config, engine, imageCache, hooks } = ctx;

  const incomingWebhooks = ctx.forms.incomingWebhooks;
  if (incomingWebhooks.length === 0) {
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

  // Find a matching webhook config entry (expand $ENV_VAR tokens). Compare
  // SHA-256 digests in constant time so neither the token's content nor its
  // length can be recovered by measuring response timing.
  const expandToken = (t: string): string => {
    if (t.startsWith("$")) {
      return Deno.env.get(t.slice(1)) ?? t;
    }
    return t;
  };
  const digest = async (t: string): Promise<string> =>
    encodeHex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)),
      ),
    );

  const tokenDigest = await digest(token);
  let matched: (typeof incomingWebhooks)[number] | undefined;
  for (const wh of incomingWebhooks) {
    if (
      timingSafeEqualStrings(await digest(expandToken(wh.token)), tokenDigest)
    ) matched = wh;
  }

  if (!matched) {
    return json({ error: "Invalid token" }, 401);
  }

  // Determine which actions to run — request body may specify a subset
  let requestedActions: string[];
  if (Array.isArray(body.actions)) {
    requestedActions = body.actions.filter(
      (a) =>
        typeof a === "string" &&
        matched.actions.includes(a as "rebuild" | "purge-cache"),
    );
  } else {
    // No specific action requested — run all permitted actions
    requestedActions = matched.actions as string[];
  }

  if (requestedActions.length === 0) {
    return json({ error: "No permitted actions match the request" }, 400);
  }

  const executed: Array<"rebuild" | "purge-cache"> = [];
  // Forwarded headers are only honoured when system.trusted_proxies is set.
  const ip = clientIp(req, {
    trustForwardedFor: config.system?.trusted_proxies === true,
  });
  const announce = (action: "rebuild" | "purge-cache") =>
    hooks.fire("onSystemAction", {
      action,
      ip: ip === "unknown" ? null : ip,
      userAgent: req.headers.get("user-agent"),
    }).catch((err: unknown) =>
      logger.error("forms.webhook.hook_failed", { reason: String(err) })
    );

  try {
    for (const action of requestedActions) {
      if (action === "rebuild") {
        // Fire-and-forget — don't block the response
        engine.rebuild().catch((err: unknown) => {
          logger.error("forms.webhook.rebuild_failed", { reason: String(err) });
        });
        void announce("rebuild");
        executed.push("rebuild");
      } else if (action === "purge-cache") {
        await imageCache.clear();
        void announce("purge-cache");
        executed.push("purge-cache");
      }
    }
  } catch (err) {
    return serverError(err);
  }

  return json({ ok: true, executed });
}

// ── Contact form submission handler (public) ──────────────────────────────────

/**
 * Handle `POST /api/contact` — stores the submission under the `form_name`
 * field (default "contact") and sends the configured notifications.
 *
 * @deprecated Define `forms/contact.yaml` and post to `/api/forms/contact`:
 * that route validates against the form's schema.
 */
export async function handleContactSubmission(
  ctx: FormsRuntime,
  req: Request,
): Promise<Response> {
  const { storage, submissions, forms } = ctx;

  if (!warnedContactDeprecated) {
    warnedContactDeprecated = true;
    logger.warn("forms.contact_deprecated", {
      reason:
        "POST /api/contact is deprecated; post to /api/forms/contact (define forms/contact.yaml)",
    });
  }
  try {
    const parsed = await guardAndParseSubmission(req, ctx);
    if (parsed instanceof Response) return parsed;
    const { fields, uploadedFiles } = parsed;

    // ── Honeypot anti-spam ────────────────────────────────────────────────
    // If the configured honeypot field is present and non-empty, a bot filled
    // it in. Silently accept (so bots get no useful signal) but don't save.
    const honeypotField = forms.honeypot;
    if (fields[honeypotField]) {
      // Looks like a bot submission — return success without saving
      const acceptsJson = req.headers.get("accept")?.includes(
        "application/json",
      );
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
    const formName = /^[a-zA-Z0-9_-]{1,64}$/.test(rawFormName)
      ? rawFormName
      : "contact";

    // Pre-generate submission ID so we can store files before creating the record.
    const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
    const storedFiles = await storeUploads(
      storage,
      forms.dataDir,
      formName,
      submissionId,
      uploadedFiles,
    );

    const submitterIp = clientIp(req, {
      trustForwardedFor: ctx.config.system?.trusted_proxies === true,
    });
    const submission = await submissions.create(formName, fields, {
      ip: submitterIp === "unknown" ? undefined : submitterIp,
      language,
      userAgent,
    }, { id: submissionId, files: storedFiles });

    // Notifications (fire-and-forget) — global config only for the contact form.
    ctx.notifier.dispatch(submission);
    await ctx.hooks.fire("onFormSubmit", { form: formName, submission });

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
        if (
          refererUrl.origin === requestOrigin ||
          (publicOrigin && refererUrl.origin === publicOrigin)
        ) {
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
