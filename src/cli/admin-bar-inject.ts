/**
 * Admin session cookie helper.
 *
 * Used by the page-cache layer to decide whether a request may share the
 * anonymous page cache: any request carrying a session cookie must bypass
 * both cache read and write, otherwise a bar-injected response (admin
 * username, edit chrome, content API URLs) could be stored under the plain
 * pathname key and served to anonymous visitors.
 *
 * The actual admin bar injection is performed by `@dune/plugin-inline-edit`
 * via the `DunePlugin.transformResponse` hook.
 */

/**
 * Cheap check for the presence of an admin session cookie — no validation.
 */
export function hasAdminSessionCookie(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)dune_session=[^;]+/.test(cookie);
}
