/**
 * Plugin response-transform pipeline wiring.
 *
 * Bridges the content request path in fresh-app.ts to the plugin
 * `transformResponse` hook (see `ResponseTransformContext` in hooks/types.ts).
 * Responsibilities:
 *
 * - Resolve the editor once per request (`createEditorResolver()`), enforcing
 *   the documented contract: `auth` is non-null only for a signed-in user
 *   (site login or `editor.session` provider) who holds `pages.update`.
 *   Plugins can rely on this and must not need to re-authenticate. The
 *   permission check is `authz.check()`, the sole authority; it fails closed
 *   when authz is missing.
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

import type { DuneConfig } from "../config/types.ts";
import type { DunePlugin, ResponseTransformContext } from "../hooks/types.ts";
import type { CapabilityReader } from "../plugin-api/capabilities.ts";

import type { EditorResolver } from "../auth/editor.ts";
import type { PageIndex } from "../content/types.ts";
import { highestAdminRole, roleHasPermission } from "../auth/authz-schema.ts";
import { applyResponseTransforms } from "../plugins/loader.ts";
import { isAdminPath } from "./serve-utils.ts";
import { scrubMarkersFromResponse } from "./marker-scrub.ts";

/** What a transform sees when the caller supplies no registry: nothing is provided. */
const EMPTY_CAPABILITIES: CapabilityReader = {
  get: () => undefined,
  list: () => [],
  providers: () => [],
};

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
   * Resolves who is editing this request (`createEditorResolver()`): a site
   * user or the `editor.session` provider's user holding `pages.update`.
   * Omitted means every request is anonymous.
   */
  resolveEditor?: EditorResolver;
  /** What plugins provide; handed to transform plugins as `ResponseTransformContext.capabilities`. Omitted means nothing is provided. */
  capabilities?: CapabilityReader;
  /**
   * This site's actual `actionToRelations` map (built-ins plus whatever
   * plugins contributed via `DunePlugin.authzActions`) —
   * `BootstrapResult.authzSchema.actionToRelations`. Passed to
   * `roleHasPermission()` so the synchronous `ResponseTransformContext.auth
   * .hasPermission()` a plugin calls resolves a plugin-contributed action
   * correctly instead of only ever seeing the built-in ones.
   */
  actionToRelations?: Record<string, readonly string[]>;
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
  /** Where the admin is mounted, or null when there is no admin. */
  adminPrefix: string | null;
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
  const {
    req,
    response,
    plugins,
    resolveEditor,
    resolve,
    config,
    adminPrefix,
    actionToRelations,
    capabilities = EMPTY_CAPABILITIES,
  } = opts;

  const transformPlugins = plugins.filter((p) => p.transformResponse);

  const url = new URL(req.url);
  if (isAdminPath(url.pathname, adminPrefix)) return response;

  let transformAuth: ResponseTransformContext["auth"] = null;
  if (resolveEditor) {
    const resolved = await resolveEditor(req);
    if (resolved.ok) {
      // The context keeps its original `role: string` shape (a published hook
      // type) rather than switching to `roles`. The roles list mixes admin-tier
      // roles with content-gating tags in no guaranteed order, so the published
      // role and the synchronous hasPermission() answers use the highest
      // admin-tier entry, or they would under-privilege relative to the
      // authz.check() that already decided this user may edit.
      const role = highestAdminRole(resolved.editor.roles);
      transformAuth = {
        username: resolved.editor.username,
        role,
        hasPermission: (perm) => roleHasPermission(role, perm, actionToRelations),
      };
    }
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
      capabilities,
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
