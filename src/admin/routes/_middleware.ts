/**
 * Admin auth middleware — applies to every route under src/admin/routes/.
 * Authenticates the session cookie and attaches AuthResult to ctx.state.auth.
 * Unauthenticated requests are redirected to the login page (except /login itself).
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../types.ts";
import { getAdminContext } from "../context.ts";

const PUBLIC_PATHS = new Set(["/login"]);

export async function handler(
  ctx: FreshContext<AdminState>,
): Promise<Response> {
  const { auth, prefix } = getAdminContext();

  // Strip prefix to get the admin-relative path for public path check
  const pathname = ctx.url.pathname;
  const adminRelative = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length) || "/"
    : pathname;

  const authResult = await auth.authenticate(ctx.req);
  ctx.state.auth = authResult;

  if (!authResult.authenticated && !PUBLIC_PATHS.has(adminRelative)) {
    const loginUrl = `${prefix}/login?next=${encodeURIComponent(pathname)}`;
    return new Response(null, { status: 302, headers: { Location: loginUrl } });
  }

  return ctx.next();
}
