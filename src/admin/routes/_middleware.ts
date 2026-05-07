/**
 * Admin auth middleware — applies to every route under src/admin/routes/.
 * Authenticates the session cookie, attaches AuthResult to ctx.state.auth,
 * and applies admin-tier security headers (CSP, X-Frame-Options, etc.) on
 * every response.
 * Unauthenticated requests are redirected to the login page (except /login itself).
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../types.ts";

const PUBLIC_PATHS = new Set(["/login", "/login/logout"]);

/**
 * Headers applied to every admin response. The CSP is intentionally tight:
 * - 'self' for default and scripts (with 'wasm-unsafe-eval' for sharp/preact-runtime
 *   scenarios where wasm is needed)
 * - 'unsafe-inline' on style-src because Fresh emits some inline styles
 * - frame-ancestors 'none' to defeat clickjacking
 * - data: + blob: on img-src for media previews
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "private, no-store, must-revalidate",
};

function withSecurityHeaders(res: Response): Response {
  // Build a new headers object so we don't mutate a frozen response's headers.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Normalize the admin prefix once. Invariants:
 *   - starts with `/`
 *   - no trailing `/` (unless prefix is exactly `/`)
 * Without this normalization, configurations like `"/admin/"` produced
 * `adminRelative = "login"` (no leading slash), which then failed the
 * PUBLIC_PATHS lookup and trapped users in a redirect loop.
 */
function normalizePrefix(prefix: string): string {
  if (!prefix || prefix === "/") return "/";
  let p = prefix.startsWith("/") ? prefix : "/" + prefix;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export async function handler(
  ctx: FreshContext<AdminState>,
): Promise<Response> {
  const adminCtx = ctx.state.adminContext;

  // Fresh registers _middleware.ts globally, not scoped to the fsRoutes prefix.
  // Skip auth enforcement for all non-admin paths so / and content routes are
  // not redirected to the login page.
  if (!adminCtx) return ctx.next();
  const { auth } = adminCtx;
  const prefix = normalizePrefix(adminCtx.prefix);

  const pathname = ctx.url.pathname;
  if (prefix !== "/" && !pathname.startsWith(prefix)) return ctx.next();

  // Strip prefix to get the admin-relative path for public path check.
  // Always anchor with a leading slash so PUBLIC_PATHS lookups are stable.
  let adminRelative = prefix === "/" ? pathname : pathname.slice(prefix.length);
  if (!adminRelative.startsWith("/")) adminRelative = "/" + adminRelative;
  if (adminRelative.length > 1 && adminRelative.endsWith("/")) {
    adminRelative = adminRelative.slice(0, -1);
  }

  const authResult = await auth.authenticate(ctx.req);
  ctx.state.auth = authResult;

  if (!authResult.authenticated && !PUBLIC_PATHS.has(adminRelative)) {
    const loginUrl = `${prefix === "/" ? "" : prefix}/login?next=${encodeURIComponent(pathname)}`;
    return withSecurityHeaders(
      new Response(null, { status: 302, headers: { Location: loginUrl } }),
    );
  }

  const res = await ctx.next();
  return withSecurityHeaders(res);
}
