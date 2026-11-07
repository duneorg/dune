/**
 * Admin session cookie helper.
 *
 * Used by the page-cache layer to decide whether a request may share the
 * anonymous page cache: any request carrying a session cookie must bypass
 * both cache read and write, otherwise a bar-injected response (admin
 * username, edit chrome, content API URLs) could be stored under the plain
 * pathname key and served to anonymous visitors.
 *
 * The actual admin bar injection is performed by whatever plugin registers a
 * `DunePlugin.transformResponse` hook for it (e.g. `@dune/plugin-inline-edit`).
 */

/**
 * Cheap check for the presence of an admin session cookie — no validation.
 *
 * `names` are the cookies the `editor.session` provider declared
 * (`RequestAuthenticator.sessionCookies`). When the provider did not declare
 * any, every request that carries a `Cookie` header counts as possibly signed
 * in: core cannot know which cookie another admin uses, and a missed session
 * would put an editor's response into the shared page cache.
 */
export function hasSessionCookie(req: Request, names?: readonly string[]): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) return false;
  if (!names) return true;
  return names.some((name) =>
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=[^;]+`).test(cookie)
  );
}
