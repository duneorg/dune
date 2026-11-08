/**
 * Who is editing this request.
 *
 * Two sources, tried in this order: the site's own login (`getUser(req)`,
 * populated by `mountDuneAuth()`), then whoever the `editor.session` provider
 * signs in. Either way the identity only counts as an editor once
 * `authz.check(pages.update)` on the site resource passes, the same decision
 * for every consumer: the bar's response transform, the inline-edit WebSocket
 * and `/api/inline-edit/*`.
 *
 * @module
 */

import type { CapabilityReader } from "../plugin-api/capabilities.ts";
import type { EditorIdentity } from "../inline-edit/types.ts";
import type { DuneAuthSystem } from "./authz.ts";
import { SITE_RESOURCE } from "./authz-schema.ts";
import { getUser } from "./types.ts";
import { hasSessionCookie } from "../cli/admin-bar-inject.ts";

/** Outcome of {@link EditorResolver}: an editor, or why there is none. */
export type EditorResolution =
  | { ok: true; editor: EditorIdentity }
  | { ok: false; status: 401 | 403 };

/** Resolve the editor of a request. Never throws; a failing session lookup is "unauthenticated". */
export type EditorResolver = (req: Request) => Promise<EditorResolution>;

export interface EditorResolverOptions {
  capabilities: CapabilityReader;
  /**
   * The authz system of the site login (it holds site users' tuples; with
   * `site.auth.authz_store: db` that is not bootstrap's local one). Read per
   * request: the site login mounts after the resolver is built.
   */
  siteAuthz: () => DuneAuthSystem | undefined;
  /** The authz system bootstrap built; decides for `editor.session` users. */
  sessionAuthz: () => DuneAuthSystem | undefined;
}

/** Display name of a user record: username, else name, else email, else id. */
function displayName(user: { id: string; username?: string; name?: string; email?: string }): string {
  return user.username ?? user.name ?? user.email ?? user.id;
}

function canUpdatePages(authz: DuneAuthSystem | undefined, userId: string): Promise<boolean> {
  // Fail closed: no authz system means nobody is an editor.
  if (!authz) return Promise.resolve(false);
  return authz.check({
    who: { type: "user", id: userId },
    // deno-lint-ignore no-explicit-any
    canThey: "pages.update" as any,
    onWhat: SITE_RESOURCE,
  }).catch(() => false);
}

/** Build the {@link EditorResolver} of a site. */
export function createEditorResolver(opts: EditorResolverOptions): EditorResolver {
  return async (req) => {
    const siteUser = getUser(req);
    if (siteUser) {
      if (!await canUpdatePages(opts.siteAuthz(), siteUser.id)) return { ok: false, status: 403 };
      return {
        ok: true,
        editor: { id: siteUser.id, username: displayName(siteUser), roles: siteUser.roles, source: "site" },
      };
    }

    const provider = opts.capabilities.get("editor.session");
    if (!provider || !hasSessionCookie(req, provider.sessionCookies)) return { ok: false, status: 401 };
    const result = await provider.authenticate(req).catch(() => null);
    // deno-lint-ignore no-explicit-any
    const user = (result as any)?.authenticated ? (result as any).user : null;
    if (!user?.id) return { ok: false, status: 401 };
    if (!await canUpdatePages(opts.sessionAuthz(), user.id as string)) return { ok: false, status: 403 };
    return {
      ok: true,
      editor: {
        id: user.id as string,
        username: displayName(user),
        roles: (user.roles as string[] | undefined) ?? [],
        source: "session",
      },
    };
  };
}
