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
import { GRANT_RELATIONS, type GrantRelation, type RoleGrants } from "./role-grants.ts";
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
  /** The site's `system.role_grants`: which group holds which relation. */
  grants: () => RoleGrants;
}

const RANK: Record<GrantRelation, number> = { admin: 3, editor: 2, author: 1 };

/**
 * The highest admin-tier relation `roles` carry on this site: through the
 * groups `grants` maps, else (an account an admin plugin seeded directly) the
 * role name itself. `author`, the least privilege, when neither says.
 */
export function relationOf(roles: readonly string[], grants: RoleGrants): GrantRelation {
  let best: GrantRelation | undefined;
  for (const role of roles) {
    const candidates = [grants[role], GRANT_RELATIONS.includes(role as GrantRelation) ? role as GrantRelation : undefined];
    for (const r of candidates) if (r && (!best || RANK[r] > RANK[best])) best = r;
  }
  return best ?? "author";
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
        editor: {
          id: siteUser.id,
          username: displayName(siteUser),
          roles: siteUser.roles,
          relation: relationOf(siteUser.roles, opts.grants()),
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
    if (!await canUpdatePages(opts.sessionAuthz(), user.id as string)) return { ok: false, status: 403 };
    return {
      ok: true,
      editor: {
        id: user.id as string,
        username: displayName(user),
        roles: (user.roles as string[] | undefined) ?? [],
        relation: relationOf((user.roles as string[] | undefined) ?? [], opts.grants()),
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
