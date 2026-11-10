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
import { RELATION_PROBE_ACTIONS, SITE_RESOURCE } from "./authz-schema.ts";
import { getUser } from "./types.ts";
import type { GrantRelation } from "./role-grants.ts";
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

/**
 * The admin-tier relation `userId` actually holds on the site, read from the
 * authz system, or null when they may not edit pages at all. Asking authz (and
 * not inferring from role names) is what keeps this right under
 * `system.role_grants`: a user in `group:editor` remapped to `author` holds
 * `author`, whatever their role is called, and an account seeded with a direct
 * tuple holds what the tuple says.
 */
async function editorRelation(authz: DuneAuthSystem | undefined, userId: string): Promise<GrantRelation | null> {
  // Fail closed: no authz system means nobody is an editor.
  if (!authz) return null;
  const can = (action: string) =>
    authz.check({
      who: { type: "user", id: userId },
      // deno-lint-ignore no-explicit-any
      canThey: action as any,
      onWhat: SITE_RESOURCE,
    }).catch(() => false);
  if (!await can("pages.update")) return null;
  if (await can(RELATION_PROBE_ACTIONS.admin)) return "admin";
  if (await can(RELATION_PROBE_ACTIONS.editor)) return "editor";
  return "author";
}

/** Build the {@link EditorResolver} of a site. */
export function createEditorResolver(opts: EditorResolverOptions): EditorResolver {
  return async (req) => {
    const siteUser = getUser(req);
    if (siteUser) {
      const relation = await editorRelation(opts.siteAuthz(), siteUser.id);
      if (!relation) return { ok: false, status: 403 };
      return {
        ok: true,
        editor: {
          id: siteUser.id,
          username: displayName(siteUser),
          roles: siteUser.roles,
          relation,
          source: "site",
        },
      };
    }

    const provider = opts.capabilities.get("editor.session");
    if (!provider || !hasSessionCookie(req, provider.sessionCookies)) return { ok: false, status: 401 };
    const result = await provider.authenticate(req).catch(() => null);
    // deno-lint-ignore no-explicit-any
    const user = (result as any)?.authenticated ? (result as any).user : null;
    if (!user?.id) return { ok: false, status: 401 };
    const relation = await editorRelation(opts.sessionAuthz(), user.id as string);
    if (!relation) return { ok: false, status: 403 };
    return {
      ok: true,
      editor: {
        id: user.id as string,
        username: displayName(user),
        roles: (user.roles as string[] | undefined) ?? [],
        relation,
        source: "session",
      },
    };
  };
}

/**
 * Whether `editor` may edit the page with this frontmatter. An editor whose
 * {@link EditorIdentity.relation} is `admin` or `editor` may edit any page; an
 * `author` only the pages it created, recorded as `createdBy` in the frontmatter. `null` is a path that is
 * not a page, which nobody may edit.
 *
 * The HTTP routes of the inline-edit provider apply the same rule at commit;
 * core applies it at the WebSocket too, so a live session cannot be opened on a
 * page whose commit would be refused.
 */
export function mayEditPage(
  editor: Pick<EditorIdentity, "id" | "relation">,
  frontmatter: Record<string, unknown> | null,
): boolean {
  if (!frontmatter) return false;
  if (editor.relation === "admin" || editor.relation === "editor") return true;
  return frontmatter.createdBy === editor.id;
}
