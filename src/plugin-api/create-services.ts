import type { PluginServices, PluginServicesOptions } from "./services.ts";
import { sanitizeHtml } from "../security/sanitize-html.ts";
import { safeFetch } from "../security/ssrf.ts";
import { checkBodySize, limitedBody } from "../security/body-limit.ts";
import { checkPasswordStrength } from "../security/password-strength.ts";
import { clientIp, RateLimiter } from "../security/rate-limit.ts";
import { LocalRateLimitStore } from "../security/rate-limit-store.ts";
import { parseUserYaml } from "../security/safe-yaml.ts";
import { createSessionManager, createSessionStore, resolveSessionPrefix } from "../session/mod.ts";
import { createLocalUserStore } from "../auth/user-store.ts";
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from "../auth/passwords.ts";
import { logger } from "../core/logger.ts";

/**
 * Build the services handed to plugins. Depends only on config and storage, so
 * it is available to `setup()` as well as `mount()`.
 */
export function createPluginServices(opts: PluginServicesOptions): PluginServices {
  const { config, storage } = opts;
  return {
    security: {
      sanitizeHtml,
      safeFetch,
      checkBodySize,
      limitedBody,
      checkPasswordStrength,
      clientIp,
      parseUserYaml,
    },
    rateLimit: {
      createLimiter: (maxRequests, windowMs, store) => new RateLimiter(maxRequests, windowMs, store),
      createLocalStore: () => new LocalRateLimitStore(),
    },
    sessions: {
      async createManager({ sessionsDir, lifetimeMs }) {
        const cfg = config.system?.session_store;
        const url = cfg?.url
          ? (cfg.url.startsWith("$") ? Deno.env.get(cfg.url.slice(1)) : cfg.url)
          : undefined;
        const store = await createSessionStore({
          type: cfg?.type ?? "local",
          redisUrl: url,
          storage,
          sessionsDir,
          lifetimeMs,
          prefix: resolveSessionPrefix(cfg?.prefix),
        });
        return createSessionManager(store, lifetimeMs);
      },
    },
    users: {
      createLocalStore: ({ usersDir }) => createLocalUserStore({ storage, usersDir }),
    },
    passwords: {
      hash: hashPassword,
      verify: verifyPassword,
      needsRehash,
      dummyHash: DUMMY_HASH,
    },
    logger,
  };
}
