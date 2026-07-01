/**
 * Dune authorization system — polizy-backed, Zanzibar-inspired.
 *
 * This module creates and exports the `AuthSystem` singleton used throughout
 * Dune for all permission checks:
 *
 *   - Content gating (`roles:` frontmatter)
 *   - Route middleware guards
 *   - Resource-level grants
 *
 * Usage:
 *   The `authz` instance is created in `mountDuneAuth()` and wired into the
 *   content gating layer via `setGatingAuthz()`. Application code and plugins
 *   can import `createDuneAuthSystem` to create their own instance if needed,
 *   but normally they consume `authz` from context.
 *
 * Common patterns:
 *
 *   // Check group membership (content gating)
 *   const ok = await authz.check({
 *     who: { type: "user", id: userId },
 *     canThey: "access",
 *     onWhat: { type: "group", id: "member" },
 *   });
 *
 *   // Grant group membership (after login or payment)
 *   await authz.addMember({
 *     member: { type: "user", id: userId },
 *     group: { type: "group", id: "member" },
 *   });
 *
 *   // Grant a direct permission
 *   await authz.allow({
 *     who: { type: "user", id: userId },
 *     toBe: "owner",
 *     onWhat: { type: "resource", id: pageRoute },
 *   });
 *
 * See: .claude/skills/dune-authz.md for full patterns and examples.
 * @module
 */

import { AuthSystem } from "polizy";
import { duneAuthzSchema } from "./authz-schema.ts";
import { AuthzLocalAdapter } from "./authz-adapter-local.ts";
import { AuthzDbAdapter } from "./authz-adapter-db.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DbAdapter } from "../db/types.ts";
import { logger } from "../core/logger.ts";

export { AuthzLocalAdapter } from "./authz-adapter-local.ts";
export { AuthzDbAdapter } from "./authz-adapter-db.ts";
export { duneAuthzSchema } from "./authz-schema.ts";
export type { DuneAuthzSchema } from "./authz-schema.ts";

/** The configured Dune AuthSystem type — fully typed against the Dune schema. */
export type DuneAuthSystem = AuthSystem<typeof duneAuthzSchema>;

/** Options for {@link createDuneAuthSystem}. */
export interface AuthzConfig {
  /** Storage tier for permission tuples. Default: "local" (flat files). */
  authzStore?: "local" | "db";
  /** Base data directory, e.g. "data". Default: "data". Used only when authzStore is "local". */
  dataDir?: string;
  /**
   * DbAdapter for the "db" storage tier. Required when authzStore is "db".
   * Obtain via createDbAdapter() from @dune/core/db.
   */
  dbAdapter?: DbAdapter;
  /**
   * Optional HMAC-SHA256 key for tuple file integrity verification.
   * Only applies to authzStore: "local" — DB adapters rely on DB-level integrity.
   * Load from DUNE_AUTHZ_HMAC_SECRET via `loadHmacKeyFromEnv()`.
   */
  hmacKey?: CryptoKey | null;
}

/** Return value of {@link createDuneAuthSystem} — the configured AuthSystem plus its underlying adapter. */
export interface DuneAuthBundle {
  /** The configured polizy AuthSystem — call `authz.check()`, `authz.addMember()`, etc. */
  authz: DuneAuthSystem;
  /**
   * The underlying adapter.
   * AuthzLocalAdapter for authzStore: "local"; AuthzDbAdapter for authzStore: "db".
   */
  adapter: AuthzLocalAdapter | AuthzDbAdapter;
}

/**
 * Create a Dune AuthSystem backed by the configured storage tier.
 *
 * Returns both the AuthSystem and the underlying adapter so that callers
 * (bootstrap, mount) share the same tuple index / DB connection.
 *
 * Normally called once in `mountDuneAuth()`. Pass `bundle.authz` to
 * `setGatingAuthz()` to wire content gating.
 *
 * @param config.authzStore  "local" (default) or "db"
 * @param config.dbAdapter   Required when authzStore is "db"
 * @param storage            DuneStorageAdapter — only used for authzStore: "local"
 */
export function createDuneAuthSystem(
  config: AuthzConfig,
  storage: StorageAdapter,
): DuneAuthBundle {
  let adapter: AuthzLocalAdapter | AuthzDbAdapter;

  if (config.authzStore === "db") {
    if (!config.dbAdapter) {
      throw new Error(
        "[dune/authz] createDuneAuthSystem: authzStore is 'db' but no dbAdapter was provided. " +
          "Pass config.dbAdapter (obtain via createDbAdapter() from @dune/core/db).",
      );
    }
    adapter = new AuthzDbAdapter(config.dbAdapter);
  } else {
    // authzStore: "local" (default)
    // Warn when dataDir is not provided — the default "data" resolves relative to
    // process CWD, which is unpredictable in headless/test contexts.
    const dataDir = config.dataDir ?? "data";
    if (!config.dataDir) {
      logger.warn("authz.datadir.default", {
        reason:
          "createDuneAuthSystem: dataDir not set — defaulting to \"data\" " +
          "(relative to process CWD). Pass an explicit absolute path to avoid resolving " +
          "permissions to the wrong directory in non-standard server setups.",
      });
    }
    adapter = new AuthzLocalAdapter({ storage, dataDir, hmacKey: config.hmacKey });
  }
  const authz = new AuthSystem({
    schema: duneAuthzSchema,
    // Cast required because polizy's StorageAdapter<S,O> generic parameters
    // don't align with the structural types from AuthzLocalAdapter — the
    // implementation is fully compatible at runtime.
    // deno-lint-ignore no-explicit-any
    storage: adapter as any,
  });
  return { authz, adapter };
}

/**
 * Bootstrap permission tuples from a list of (userId, roles[]) pairs.
 *
 * On first startup after polizy is introduced, this derives group membership
 * tuples from the `roles` array on existing SiteUser records. Idempotent —
 * skips tuples that already exist.
 *
 * Called by `mountDuneAuth()` after constructing the AuthSystem.
 */
/** Minimal interface required by bootstrap helpers — satisfied by both local and db adapters. */
export interface AuthzAdapterLike {
  hasTuple(subject: { type: string; id: string }, relation: string, object: { type: string; id: string }): Promise<boolean>;
}

/**
 * Bootstrap role-based permission tuples from existing SiteUser `roles[]`.
 *
 * Idempotent — skips tuples that already exist. Call once on first startup
 * after introducing polizy into an existing site.
 */
export async function bootstrapRoleTuples(
  authz: DuneAuthSystem,
  adapter: AuthzAdapterLike,
  users: Array<{ id: string; roles: string[] }>,
): Promise<void> {
  for (const user of users) {
    for (const role of user.roles) {
      const subject = { type: "user" as const, id: user.id };
      const relation = "member";
      const object = { type: "group" as const, id: role };

      const exists = await adapter.hasTuple(subject, relation, object);
      if (!exists) {
        await authz.addMember({
          member: subject,
          group: object,
        });
      }
    }
  }
}

/**
 * Bootstrap permission tuples for existing AdminUser records.
 *
 * Each admin user gets a direct relation tuple on `{ type: "app", id: "admin" }`
 * matching their role ("admin", "editor", or "author"). Idempotent — skips
 * tuples that already exist.
 *
 * Called by `bootstrap()` during startup. Role changes and deletes are kept in
 * sync via the admin user route handlers in `src/admin/routes/api/users/`.
 */
export async function bootstrapAdminTuples(
  authz: DuneAuthSystem,
  adapter: AuthzAdapterLike,
  adminUsers: Array<{ id: string; role: string }>,
): Promise<void> {
  for (const user of adminUsers) {
    const subject = { type: "user" as const, id: user.id };
    const object = { type: "app" as const, id: "admin" };
    const exists = await adapter.hasTuple(subject, user.role, object);
    if (!exists) {
      await authz.allow({
        who: subject,
        toBe: user.role as "admin" | "editor" | "author",
        onWhat: object,
      });
    }
  }
}
