/**
 * Admin auth middleware — applies to every route under src/admin/routes/.
 * Authenticates the session cookie and attaches AuthResult to ctx.state.auth.
 * Unauthenticated requests are redirected to the login page (except /login itself).
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../types.ts";

const PUBLIC_PATHS = new Set(["/login"]);

export async function handler(
  ctx: FreshContext<AdminState>,
): Promise<Response> {
  const adminCtx = ctx.state.adminContext;

  // Fresh registers _middleware.ts globally, not scoped to the fsRoutes prefix.
  // Skip auth enforcement for all non-admin paths so / and content routes are
  // not redirected to the login page.
  if (!adminCtx) return ctx.next();
  const { auth, prefix } = adminCtx;

  const pathname = ctx.url.pathname;
  if (!pathname.startsWith(prefix)) return ctx.next();

  // Strip prefix to get the admin-relative path for public path check
  const adminRelative = pathname.slice(prefix.length) || "/";

  const authResult = await auth.authenticate(ctx.req);
  ctx.state.auth = authResult;

  if (!authResult.authenticated && !PUBLIC_PATHS.has(adminRelative)) {
    const loginUrl = `${prefix}/login?next=${encodeURIComponent(pathname)}`;
    return new Response(null, { status: 302, headers: { Location: loginUrl } });
  }

  return ctx.next();
}
