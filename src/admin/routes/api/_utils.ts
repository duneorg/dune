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

export function serverError(err: unknown): Response {
  console.error("[admin api]", err);
  const msg = err instanceof Error ? err.message : String(err);
  return json({ error: msg }, 500);
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
      return json({ error: "Forbidden: cross-origin request rejected" }, 403);
    }
  } catch {
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
