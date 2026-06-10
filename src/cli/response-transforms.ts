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
 *   need to re-authenticate.
 * - Never run transforms on admin-panel paths (defense in depth — admin
 *   routes are mounted separately and should never reach the content
 *   catch-all, but the pipeline must not depend on routing order alone).
 * - Match the content page for the current URL so plugins receive `page`.
 *
 * Used by both the production and dev request paths in fresh-app.ts.
 */

import type { AuthMiddleware } from "../admin/auth/middleware.ts";
import type { AdminPermission } from "../admin/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { DunePlugin, ResponseTransformContext } from "../hooks/types.ts";
import type { PageIndex } from "../content/types.ts";
import { applyResponseTransforms } from "../plugins/loader.ts";
import { hasAdminSessionCookie } from "./admin-bar-inject.ts";
import { isAdminPath } from "./serve-utils.ts";

/** Options for {@link runPluginResponseTransforms}. */
export interface RunResponseTransformsOptions {
  req: Request;
  /** The rendered response — returned unchanged when no transform applies. */
  response: Response;
  /** All registered plugins; filtered on `transformResponse` internally. */
  plugins: DunePlugin[];
  auth: Pick<AuthMiddleware, "authenticate" | "hasPermission">;
  /** Content index used to match the current URL to a page. */
  pages: Pick<PageIndex, "route" | "sourcePath" | "title">[];
  config: DuneConfig;
  adminPrefix: string;
}

/**
 * Run the plugin `transformResponse` pipeline for a content response.
 *
 * Auth resolution is skipped entirely when no plugin registers a transform
 * or when the request carries no admin session cookie, so anonymous traffic
 * pays no session-lookup cost.
 *
 * @since 0.17.0
 */
export async function runPluginResponseTransforms(
  opts: RunResponseTransformsOptions,
): Promise<Response> {
  const { req, response, plugins, auth, pages, config, adminPrefix } = opts;

  const transformPlugins = plugins.filter((p) => p.transformResponse);
  if (transformPlugins.length === 0) return response;

  const url = new URL(req.url);
  if (isAdminPath(url.pathname, adminPrefix)) return response;

  let transformAuth: ResponseTransformContext["auth"] = null;
  if (hasAdminSessionCookie(req)) {
    try {
      const result = await auth.authenticate(req);
      // Contract (ResponseTransformContext.auth): non-null only when the
      // session is valid AND holds pages.update — same gate the pre-plugin
      // admin-bar injector enforced.
      if (
        result.authenticated && result.user &&
        auth.hasPermission(result, "pages.update")
      ) {
        const user = result.user;
        transformAuth = {
          username: user.username,
          role: user.role,
          hasPermission: (perm) => auth.hasPermission(result, perm as AdminPermission),
        };
      }
    } catch { /* invalid session — treat as unauthenticated */ }
  }

  const matchedPage = pages.find((p) => p.route === url.pathname);
  return await applyResponseTransforms(transformPlugins, {
    req,
    response,
    auth: transformAuth,
    config,
    page: matchedPage?.sourcePath
      ? {
        sourcePath: matchedPage.sourcePath,
        route: matchedPage.route,
        title: matchedPage.title ?? null,
      }
      : null,
    adminPrefix,
  });
}
