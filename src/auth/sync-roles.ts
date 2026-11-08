/**
 * Keep a user's group membership in the authz store equal to their `roles[]`.
 *
 * Page gating (`roles:` frontmatter) and the site-wide grants of the
 * admin-tier roles ({@link bootstrapRoleGrants}) both read
 * `member of group:<role>` tuples, while `roles[]` on the user record is
 * what administrators and payment hooks change. Seeding at startup
 * ({@link bootstrapRoleTuples}) is not enough on its own: a role granted or
 * revoked in a running app would only take effect after a restart.
 *
 * Wrap the user store with {@link withRoleSync} so every writer is covered
 * and none has to remember to call it.
 *
 * @module
 */

import type { DuneAuthSystem } from "./authz.ts";
import type { UserStore } from "./user-store.ts";
import { logger } from "../core/logger.ts";

/** What {@link syncUserRoles} needs from the authz bundle. */
export interface RoleSyncTarget {
  authz: DuneAuthSystem;
  adapter: {
    findObjects(
      subject: { type: string; id: string },
      relation: string,
      options?: { objectType?: string },
    ): Promise<{ type: string; id: string }[]>;
  };
}

/**
 * Make the user's `member of group:<role>` tuples match `roles`: add the
 * missing ones, remove the stale ones. Idempotent.
 *
 * "Match" is exact: a membership that is not in `roles` is removed, including
 * one a plugin added by hand with `authz.addMember()`. `roles[]` is the single
 * source of truth for group membership; a grant that `roles[]` cannot express
 * (a payment, a resource owner) should use `allow()` on a resource, not a group.
 */
export async function syncUserRoles(
  target: RoleSyncTarget,
  user: { id: string; roles: string[] },
): Promise<void> {
  const who = { type: "user" as const, id: user.id };
  const wanted = new Set(user.roles);
  const current = new Set(
    (await target.adapter.findObjects(who, "member", { objectType: "group" }))
      .map((g) => g.id),
  );
  for (const role of wanted) {
    if (!current.has(role)) {
      await target.authz.addMember({ member: who, group: { type: "group", id: role } });
    }
  }
  for (const group of current) {
    if (!wanted.has(group)) {
      await target.authz.disallowAllMatching({
        who,
        was: "member",
        onWhat: { type: "group", id: group },
      });
    }
  }
}

/** Remove every tuple a deleted user holds. */
export async function removeUserTuples(
  target: RoleSyncTarget,
  userId: string,
): Promise<void> {
  await target.authz.disallowAllMatching({ who: { type: "user", id: userId } });
}

/**
 * A user store whose writes keep group membership in step with `roles[]`.
 *
 * `getTarget` is read on every write, so the store can be created before the
 * authz system exists; with no target (no authz system) writes pass straight
 * through. A failed sync is logged, not thrown: the user write has already
 * happened, and the next start re-seeds membership from the records.
 */
export function withRoleSync(
  store: UserStore,
  getTarget: () => RoleSyncTarget | undefined,
): UserStore {
  const sync = async (fn: (t: RoleSyncTarget) => Promise<void>) => {
    const target = getTarget();
    if (!target) return;
    try {
      await fn(target);
    } catch (err) {
      logger.error("authz.role_sync_failed", { reason: String(err) });
    }
  };
  const overrides: Pick<UserStore, "create" | "update" | "delete"> = {
    async create(input) {
      const user = await store.create(input);
      await sync((t) => syncUserRoles(t, user));
      return user;
    },
    async update(id, updates) {
      const user = await store.update(id, updates);
      if (user && updates.roles !== undefined) {
        await sync((t) => syncUserRoles(t, user));
      }
      return user;
    },
    async delete(id) {
      const deleted = await store.delete(id);
      if (deleted) await sync((t) => removeUserTuples(t, id));
      return deleted;
    },
  };
  // A proxy rather than a spread, so stores written as classes keep working.
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (Object.hasOwn(overrides, prop)) return overrides[prop as keyof typeof overrides];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
