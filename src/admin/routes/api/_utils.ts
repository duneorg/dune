/**
 * Shared utilities for admin API route handlers.
 */

import type { FreshContext } from "fresh";
import type { AdminState, AdminPermission } from "../../types.ts";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Typed errors that admin route handlers can throw to map onto specific
 * status codes. Anything else is logged and returned as a generic 500 with
 * no internal details, so internal stack-trace-adjacent strings can't leak
 * to authenticated callers (they're still useful, but admins shouldn't be
 * able to read e.g. database errors verbatim).
 */
export class ValidationError extends Error {
  override name = "ValidationError";
}
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
export class PermissionError extends Error {
  override name = "PermissionError";
}

export function serverError(err: unknown): Response {
  console.error("[admin api]", err);

  if (err instanceof ValidationError) {
    return json({ error: err.message || "Bad request" }, 400);
  }
  if (err instanceof NotFoundError) {
    return json({ error: err.message || "Not found" }, 404);
  }
  if (err instanceof PermissionError) {
    return json({ error: "Forbidden" }, 403);
  }
  // Map Deno's filesystem permission errors to 403 — this restores the
  // mapping the old server.ts had (lost in the Fresh 2 rewrite).
  if (err instanceof Deno.errors.PermissionDenied) {
    return json({ error: "Forbidden" }, 403);
  }
  if (err instanceof Deno.errors.NotFound) {
    return json({ error: "Not found" }, 404);
  }

  // Generic — never leak err.message to the client.
  return json({ error: "Internal server error" }, 500);
}

function logAuthzDenial(
  ctx: FreshContext<AdminState>,
  event: "auth.csrf_denied" | "auth.permission_denied",
  detail: Record<string, unknown>,
): void {
  const { auditLogger } = ctx.state.adminContext;
  if (!auditLogger) return;
  void auditLogger.log({
    event,
    actor: actorFromAuth(ctx.state.auth ?? {}),
    ip: getClientIp(ctx.req),
    userAgent: ctx.req.headers.get("user-agent") ?? null,
    target: { type: "route", id: ctx.url.pathname },
    detail,
    outcome: "failure",
  }).catch(() => {});
}

/** CSRF check: reject cross-origin mutating requests. */
export function csrfCheck(ctx: FreshContext<AdminState>): Response | null {
  const method = ctx.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const origin = ctx.req.headers.get("origin");
  if (origin === null) return null;
  const requestHost = ctx.url.host;
  try {
    if (new URL(origin).host !== requestHost) {
      logAuthzDenial(ctx, "auth.csrf_denied", { origin, method });
      return json({ error: "Forbidden: cross-origin request rejected" }, 403);
    }
  } catch {
    logAuthzDenial(ctx, "auth.csrf_denied", { origin, method, parseError: true });
    return json({ error: "Forbidden: cross-origin request rejected" }, 403);
  }
  return null;
}

/** Permission check — returns 403 response if denied, null if allowed. */
export function requirePermission(
  ctx: FreshContext<AdminState>,
  permission: AdminPermission,
): Response | null {
  const { auth } = ctx.state.adminContext;
  if (!auth.hasPermission(ctx.state.auth, permission)) {
    logAuthzDenial(ctx, "auth.permission_denied", { permission });
    return json({ error: "Forbidden" }, 403);
  }
  return null;
}

/**
 * Validate a page-path-like string from a URL parameter.
 *
 * Rejects:
 *   - Empty strings, paths longer than 1024 chars
 *   - Absolute paths (leading `/` or `\`, drive letters)
 *   - Null bytes (used to terminate paths early in some toolchains)
 *   - URL-encoded `..` (we do not decode here; the caller must pass an
 *     already-decoded string and we still scan for percent-encoded forms
 *     defence-in-depth)
 *   - Any segment that is empty, `.`, `..`, or contains characters outside
 *     `[a-zA-Z0-9._@-]` (allows scoped names; nothing exotic)
 *   - Backslashes (case-insensitive filesystems treat them as separators)
 */
export function validatePagePath(p: string): boolean {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 1024) return false;
  if (p.includes("\0")) return false;
  if (p.includes("\\")) return false;
  if (p.startsWith("/")) return false;
  // Defence-in-depth: refuse already-encoded ".." or null bytes that some
  // callers may forget to decode.
  const lower = p.toLowerCase();
  if (lower.includes("%2e%2e") || lower.includes("%00")) return false;
  // Reject Windows-style absolute paths (e.g. "C:\foo" already rejected by
  // the backslash check; "C:/foo" is rejected here).
  if (/^[a-zA-Z]:\//.test(p)) return false;

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // empty / repeated slashes
    if (seg === "." || seg === "..") return false;
    if (!/^[a-zA-Z0-9._@-]+$/.test(seg)) return false;
  }
  return true;
}

/**
 * Best-effort client IP for audit logging. This is *audit only* —
 * X-Forwarded-For / X-Real-IP can be spoofed by clients unless the
 * deployment is behind a trusted proxy. Callers that need an IP for
 * security decisions (rate limiting, lockout) should use the equivalent
 * trusted-proxy-aware helper in src/security/rate-limit.ts.
 */
export function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip")
    ?? null;
}

export function actorFromAuth(
  authResult: { user?: { id: string; username: string; name: string } | null },
): import("../../../audit/mod.ts").AuditActor | null {
  if (!authResult.user) return null;
  return {
    userId: authResult.user.id,
    username: authResult.user.username,
    name: authResult.user.name,
  };
}

// ── withGuards: declarative guard wrapper for admin handlers ─────────────────
//
// Most admin routes need the same three guards in the same order:
//   1. csrfCheck()           — reject cross-origin mutating requests
//   2. requirePermission()   — confirm the actor has the required permission
//   3. validatePagePath()    — confirm a path-shaped URL parameter is safe
//
// Re-implementing this on every route is what caused HIGH-1, HIGH-4, and
// MED-23 in the May 2026 audit (regressions of prior fixes). The wrapper
// below makes the guards declarative, so adding a new mutating route can't
// silently forget any of them. Existing routes are converted incrementally;
// a Deno test (tests/admin/guards_test.ts) enforces that every mutating
// handler invokes csrfCheck either directly or via withGuards.
//
// Refs: claudedocs/security-audit-2026-05.md MED-23 (CWE-264).

export interface WithGuardsOptions {
  /**
   * Run csrfCheck. Defaults to true — pass false only on genuinely safe
   * read-only handlers (which usually don't need this wrapper anyway).
   */
  csrf?: boolean;
  /** Require the authenticated actor to hold this permission. */
  permission?: AdminPermission;
  /**
   * Validate a URL-path-shaped parameter against validatePagePath().
   * Pass the param name; e.g. `validatePath: "path"` for `/api/pages/:path`.
   */
  validatePath?: string;
}

export type GuardedHandler<P = Record<string, string>> = (
  ctx: FreshContext<AdminState> & { params: P },
) => Response | Promise<Response>;

export function withGuards<P = Record<string, string>>(
  opts: WithGuardsOptions,
  handler: GuardedHandler<P>,
): GuardedHandler<P> {
  return async (ctx) => {
    if (opts.csrf !== false) {
      const csrfDenied = csrfCheck(ctx);
      if (csrfDenied) return csrfDenied;
    }
    if (opts.permission) {
      const permDenied = requirePermission(ctx, opts.permission);
      if (permDenied) return permDenied;
    }
    if (opts.validatePath) {
      const params = ctx.params as Record<string, string>;
      const raw = params?.[opts.validatePath];
      if (typeof raw !== "string" || !validatePagePath(raw)) {
        return json({ error: "Invalid path" }, 400);
      }
    }
    try {
      return await handler(ctx);
    } catch (err) {
      return serverError(err);
    }
  };
}
