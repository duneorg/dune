/**
 * Shared utilities for admin API route handlers.
 */

import type { FreshContext } from "fresh";
import type { AdminState, AdminPermission } from "../../types.ts";
import { getAdminContext } from "../../context.ts";

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
  const { auth } = getAdminContext();
  if (!auth.hasPermission(ctx.state.auth, permission)) {
    return json({ error: "Forbidden" }, 403);
  }
  return null;
}

export function validatePagePath(p: string): boolean {
  return !p.includes("..") && !p.startsWith("/");
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
