/**
 * Plugin response-transform pipeline wiring.
 *
 * Bridges the content request path in fresh-app.ts to the plugin
 * `transformResponse` hook (see `ResponseTransformContext` in hooks/types.ts).
 * Responsibilities:
 *
 * - Resolve the auth context once per request, enforcing the documented
 *   contract: `auth` is non-null only for a valid admin session that holds
 *   the `pages.update` permission. Plugins can rely on this and must not
 *   need to re-authenticate. The permission check itself is `authz.check()` —
 *   the sole authority every admin permission check follows
 *   (dec-identity-unification Phase 5c/6/7); if `authz` is somehow
 *   undefined (authz creation itself failed at startup — already logged
 *   loudly there), this fails closed rather than falling back to a
 *   separate, less-audited mechanism.
 * - Never run transforms on admin-panel paths (defense in depth — admin
 *   routes are mounted separately and should never reach the content
 *   catch-all, but the pipeline must not depend on routing order alone).
 * - Match the content page for the current URL so plugins receive `page`,
 *   via the same route resolver the content pipeline itself uses (so the
 *   home page, aliases, and multilingual routes all resolve identically —
 *   a prior hand-rolled matcher here missed the home-page mapping, so the
 *   admin bar never rendered on any site's homepage).
 * - Scrub `data-dune-*` marker attributes from responses that do not belong
 *   to a validated editing session (see `marker-scrub.ts`) — markers are an
 *   admin-only contract and never ship to anonymous visitors.
 *
 * Used by both the production and dev request paths in fresh-app.ts.
 */

/**
 * Minimal auth middleware interface — concrete type is from `@dune/plugin-admin`.
 * `authenticate()` is still the only way to validate an admin session cookie
 * (core doesn't own admin session cookie config).
 */
interface AdminAuthMiddleware {
  authenticate(req: Request): Promise<unknown>;
}
import type { DuneConfig } from "../config/types.ts";
import type { DunePlugin, ResponseTransformContext } from "../hooks/types.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { PageIndex } from "../content/types.ts";
import { highestAdminRole, roleHasPermission } from "../auth/authz-schema.ts";
import { applyResponseTransforms } from "../plugins/loader.ts";
import { hasAdminSessionCookie } from "./admin-bar-inject.ts";
import { isAdminPath } from "./serve-utils.ts";
import { scrubMarkersFromResponse } from "./marker-scrub.ts";

/**
 * Narrow shape accepted from a route resolver's result — just the fields
 * this module actually reads. `RouteResolver.resolve()` (`routing/resolver.ts`)
 * returns the wider `RouteMatch` (`page: PageIndex`), which is structurally
 * assignable here since `PageIndex` is a superset of this `Pick`.
 */
type ResolvedRoute = {
  type: "page" | "redirect";
  page?: Pick<PageIndex, "route" | "sourcePath" | "title" | "language" | "template">;
} | null;

/** Options for {@link runPluginResponseTransforms}. */
export interface RunResponseTransformsOptions {
  req: Request;
  /** The rendered response — returned unchanged when no transform applies. */
  response: Response;
  /** All registered plugins; filtered on `transformResponse` internally. */
  plugins: DunePlugin[];
  /**
   * Admin auth middleware — null when the admin plugin is disabled or not yet mounted.
   * When null, all sessions are treated as anonymous (transformAuth stays null).
   */
  auth: AdminAuthMiddleware | null;
  /**
   * Polizy authz system — the sole authority for the `pages.update` check
   * below (dec-identity-unification Phase 5c/7). Undefined only when authz
   * creation itself failed at startup (already logged loudly there — see
   * `src/runtime/bootstrap.ts`), in which case the check fails closed.
   */
  authz?: DuneAuthSystem;
  /**
   * Resolves a URL pathname to the matching page — pass `engine.router.resolve`
   * so this uses the exact same home-page/language/alias-aware resolution the
   * content pipeline itself renders with. A hand-rolled route-matcher here
   * previously missed the home-page mapping ("/" → whatever folder is
   * configured/autodetected as home), so the admin bar silently never
   * rendered on any site's homepage — see the fix that added this field.
   */
  resolve: (pathname: string) => ResolvedRoute;
  config: DuneConfig;
  adminPrefix: string;
}

/**
 * Run the plugin `transformResponse` pipeline for a content response, then
 * scrub `data-dune-*` marker attributes from the body unless the request
 * carries a valid editing session (`pages.update`).
 *
 * Auth resolution is skipped when the request carries no admin session
 * cookie, so anonymous traffic pays no session-lookup cost — it goes
 * straight to the marker scrub. A request with a cookie is authenticated
 * (even when no plugin registers a transform): the scrub decision must rest
 * on a *validated* session, not cookie presence, or a forged cookie would
 * skip it.
 *
 * @since 0.17.0
 */
export async function runPluginResponseTransforms(
  opts: RunResponseTransformsOptions,
): Promise<Response> {
  const { req, response, plugins, auth, authz, resolve, config, adminPrefix } =
    opts;

  const transformPlugins = plugins.filter((p) => p.transformResponse);

  const url = new URL(req.url);
  if (isAdminPath(url.pathname, adminPrefix)) return response;

  let transformAuth: ResponseTransformContext["auth"] = null;
  if (auth && hasAdminSessionCookie(req)) {
    try {
      const result = await auth.authenticate(req);
      // Contract (ResponseTransformContext.auth): non-null only when the
      // session is valid AND holds pages.update — same gate the pre-plugin
      // admin-bar injector enforced.
      // deno-lint-ignore no-explicit-any
      const r = result as any;
      const canUpdatePages = r?.authenticated && r?.user && (
        authz
          ? await authz.check({
            who: { type: "user", id: r.user.id as string },
            // deno-lint-ignore no-explicit-any
            canThey: "pages.update" as any,
            onWhat: { type: "app", id: "admin" },
          })
          : false
      );
      if (canUpdatePages) {
        const user = r.user as Record<string, unknown>;
        // This context field keeps its original `role: string` shape (a
        // published hook type, ResponseTransformContext — minimize churn for
        // plugin authors) rather than switching to `roles`.
        const roles = user.roles as string[] | undefined;
        // The merged User type mixes admin-tier roles with content-gating
        // tags in roles[] (e.g. ["member", "admin"]) with no guaranteed
        // order — roles[0] is not necessarily an admin role. The published
        // role string and hasPermission() answers sourced from it must use
        // the highest admin-tier entry, or the synchronous approximation
        // would under-privilege relative to what authz.check() (which
        // unions all the user's relations) decided just above.
        const role = highestAdminRole(roles);
        transformAuth = {
          username: user.username as string,
          role,
          hasPermission: (perm) => roleHasPermission(role, perm),
        };
      }
    } catch { /* invalid session — treat as unauthenticated */ }
  }

  let out = response;
  if (transformPlugins.length > 0) {
    const match = resolve(url.pathname);
    const matchedPage = match?.type === "page" ? match.page : undefined;
    out = await applyResponseTransforms(transformPlugins, {
      req,
      response,
      auth: transformAuth,
      config,
      page: matchedPage?.sourcePath
        ? {
          sourcePath: matchedPage.sourcePath,
          route: matchedPage.route,
          title: matchedPage.title ?? null,
          template: matchedPage.template,
        }
        : null,
      adminPrefix,
      // Full list (not transformPlugins) — a plugin can contribute
      // adminBarActions without declaring transformResponse itself, so the
      // bar-owning plugin needs every plugin, not just the ones already
      // selected to run their own transform.
      plugins: plugins.map((p) => ({ name: p.name, adminBarActions: p.adminBarActions })),
    });
  }

  // Markers stay only for a validated editing session. Scrubbing runs after
  // the plugin pass (defense in depth — a transform must not be able to
  // reintroduce markers into an anonymous response) and also when no
  // transform plugin is registered at all, since templates bake markers
  // regardless of which plugins are installed.
  if (!transformAuth) out = await scrubMarkersFromResponse(out);
  return out;
}
