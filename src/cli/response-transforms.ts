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
 *   need to re-authenticate. The permission check itself goes through the
 *   polizy `authz` system (`authz.check()`) when configured — the same
 *   sole-authority contract every other admin permission check follows
 *   (dec-identity-unification Phase 5c/7) — not the flat `ROLE_PERMISSIONS`
 *   table `auth.hasPermission()` alone would consult.
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
 * (core doesn't own admin session cookie config), but `hasPermission()` is
 * used only as the fallback when `authz` (below) isn't configured — see the
 * doc comment on `runPluginResponseTransforms` for why.
 */
interface AdminAuthMiddleware {
  authenticate(req: Request): Promise<unknown>;
  hasPermission(result: unknown, permission: string): boolean;
}
import type { DuneConfig } from "../config/types.ts";
import type { DunePlugin, ResponseTransformContext } from "../hooks/types.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { PageIndex } from "../content/types.ts";
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
   * Polizy authz system — when present, is the sole authority for the
   * `pages.update` check below (dec-identity-unification Phase 7). Falls
   * back to `auth.hasPermission()` only in the narrow, exceptional case
   * where authz creation itself failed at startup (already logged loudly
   * there — see `src/runtime/bootstrap.ts`).
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
          : auth.hasPermission(result, "pages.update")
      );
      if (canUpdatePages) {
        const user = r.user as Record<string, unknown>;
        // dec-identity-unification Phase 5b: the merged User type has no
        // single `role` field, only a generic `roles: string[]` — an admin
        // session always has exactly one entry in it (set by
        // @dune/plugin-admin's UserManager), so the first entry is the
        // session's admin role. This context field keeps its original
        // `role: string` shape (a published hook type, ResponseTransformContext
        // — minimize churn for plugin authors) rather than switching to `roles`.
        const roles = user.roles as string[] | undefined;
        transformAuth = {
          username: user.username as string,
          role: roles?.[0] ?? "",
          hasPermission: (perm) => auth.hasPermission(result, perm as string),
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
