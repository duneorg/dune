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
import { createWorkflowEngine } from "../workflow/engine.ts";
import { createScheduler } from "../workflow/scheduler.ts";
import { createStagingEngine } from "../staging/engine.ts";
import { createMachineTranslator } from "../mt/factory.ts";
import { AuditLogger } from "../audit/logger.ts";
import { bootstrapAdminTuples } from "../auth/authz.ts";
import { resolveBlueprint, validateFrontmatter } from "../blueprints/validator.ts";
import { resolveDataDir } from "../forms/config.ts";
import { join } from "@std/path";
import { logger } from "../core/logger.ts";

/**
 * Build the services handed to plugins. Depends only on config and storage, so
 * it is available to `setup()` as well as `mount()`.
 */
export function createPluginServices(opts: PluginServicesOptions): PluginServices {
  const { config, storage } = opts;
  const adminCfg = config.admin;
  const runtimeDir = adminCfg?.runtime_dir ?? ".dune/admin";
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
    engines: {
      workflow: createWorkflowEngine({ storage, dataDir: runtimeDir }, config.site?.workflow ?? undefined),
      scheduler: createScheduler({ storage, dataDir: runtimeDir }),
      staging: createStagingEngine({ storage, runtimeDir }),
      mt: config.site?.machine_translation ? createMachineTranslator(config.site.machine_translation) : null,
      audit: createAuditTrail(opts, runtimeDir),
    },
    blueprints: {
      has: (template) => !!opts.getBlueprints?.()[template],
      resolve(template) {
        const all = opts.getBlueprints?.() ?? {};
        const bp = all[template];
        return bp ? resolveBlueprint(template, bp, all, 0) : null;
      },
      validate: (frontmatter, template) => validateFrontmatter(frontmatter, template, opts.getBlueprints?.() ?? {}),
    },
    search: {
      analytics: {
        enabled: !!opts.searchAnalytics,
        summarize: (limit) =>
          opts.searchAnalytics?.summarize(limit) ??
            Promise.resolve({ totalSearches: 0, since: null, topQueries: [], zeroResultQueries: [] }),
      },
    },
    paths: { dataDir: resolveDataDir(config), runtimeDir },
    authz: {
      async seedAdminTuples(users) {
        const bundle = opts.getAuthz?.();
        if (!bundle) return;
        await bootstrapAdminTuples(bundle.authz, bundle.adapter, users);
      },
    },
  };
}

function createAuditTrail(opts: PluginServicesOptions, runtimeDir: string): AuditLogger | null {
  const audit = opts.config.admin?.audit;
  if (opts.config.admin?.enabled === false || audit?.enabled === false || !opts.root) return null;
  const root = opts.root;
  const logFile = audit?.log_file ? join(root, audit.log_file) : join(root, runtimeDir, "audit.log");
  const containmentRoot = root.endsWith("/") || root.endsWith("\\") ? root : root + "/";
  if (!logFile.startsWith(containmentRoot)) {
    throw new Error(
      `[dune] admin.audit.log_file must resolve under the site root. ` +
        `Got: ${audit?.log_file} -> ${logFile}`,
    );
  }
  return new AuditLogger({ logFile });
}
