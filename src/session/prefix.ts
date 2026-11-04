/**
 * Key namespace for shared session backends (Redis, Deno KV).
 *
 * Sites that point at the same Redis or the same KV database share a key
 * space. Without a prefix they also share sessions and the per-user revocation
 * index: revoking user X on one site revokes X everywhere, and a session id
 * minted by one site is accepted by another. Multisite therefore scopes the
 * keys by site id unless `system.session_store.prefix` says otherwise.
 *
 * @module
 */

/** Allowed characters in a configured prefix (it becomes part of Redis keys / KV key parts). */
const VALID_PREFIX = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Throws if `prefix` cannot safely be part of a session key. */
export function assertValidSessionPrefix(prefix: string): void {
  if (!VALID_PREFIX.test(prefix)) {
    throw new Error(
      `[dune] session_store.prefix "${prefix}" is invalid: use 1-64 characters from A-Z a-z 0-9 _ . : -`,
    );
  }
}

/**
 * The prefix a site's session store should use.
 *
 * - `configured` (`system.session_store.prefix`) wins.
 * - Otherwise, in multisite, `dune:<site id>` (characters outside the allowed
 *   set in the id become `_`).
 * - Otherwise `undefined`: single-site installs keep the original, unprefixed
 *   keys, so existing sessions survive an upgrade.
 */
export function resolveSessionPrefix(
  configured: string | undefined,
  siteId?: string,
): string | undefined {
  if (configured) return configured;
  if (!siteId) return undefined;
  return `dune:${siteId.replace(/[^A-Za-z0-9_.:-]/g, "_")}`.slice(0, 64);
}
