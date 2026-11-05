/**
 * Services core builds and hands to plugins (`PluginApi.services`,
 * `MountApi.services`).
 *
 * A plugin does not import these implementations from `@dune/core`: policy
 * that has to stay fixable by a core patch release (HTML sanitising, SSRF
 * guarding, body limits, password hashing, session backends) is reached only
 * through this object, so a plugin always runs against the policy of the core
 * that is actually running it. Only the interfaces are part of the contract.
 *
 * @module
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { Logger } from "../core/logger.ts";
import type { PasswordCheckResult } from "../security/password-strength.ts";
import type { SanitizeOptions } from "../security/sanitize-html.ts";
import type { SsrfCheckOptions } from "../security/ssrf.ts";
import type { ClientIpOptions, RateLimiter } from "../security/rate-limit.ts";
import type { RateLimitStore } from "../security/rate-limit-store.ts";
import type { SessionManager } from "../session/mod.ts";
import type { UserStore } from "../auth/user-store.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { AuthzLocalAdapter } from "../auth/authz-adapter-local.ts";
import type { AuthzDbAdapter } from "../auth/authz-adapter-db.ts";
import type { BlueprintMap, BlueprintValidationError, ResolvedBlueprint } from "../blueprints/types.ts";
import type { PageFrontmatter } from "../content/types.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { StagingEngine } from "../staging/engine.ts";
import type { MachineTranslator } from "../mt/types.ts";
import type { AuditLogger } from "../audit/logger.ts";

/** Stateless security policy. */
export interface SecurityService {
  /** Strip everything but a safe subset of HTML. */
  sanitizeHtml(input: string, opts?: SanitizeOptions): string;
  /** `fetch` that refuses private, loopback and otherwise unsafe destinations (SSRF guard). */
  safeFetch(url: string, init?: RequestInit, opts?: SsrfCheckOptions): Promise<Response>;
  /** A 413 response if the declared Content-Length exceeds `maxBytes`, else null. */
  checkBodySize(req: Request, maxBytes: number): Response | null;
  /** Wrap a body stream so reading past `maxBytes` fails with a `body_too_large` error. */
  limitedBody(stream: ReadableStream<Uint8Array> | null, maxBytes: number): ReadableStream<Uint8Array>;
  /** Password strength policy. */
  checkPasswordStrength(password: unknown): PasswordCheckResult;
  /** The client's IP, honouring forwarded headers only when `trustForwardedFor` is set. */
  clientIp(req: Request, opts?: ClientIpOptions): string;
  /** Parse YAML written by users with the safe-schema policy. */
  parseUserYaml(text: string): unknown;
}

/** Rate limiting primitives. */
export interface RateLimitService {
  /** A limiter allowing `maxRequests` per `windowMs`, optionally backed by a shared store. */
  createLimiter(maxRequests: number, windowMs: number, store?: RateLimitStore): RateLimiter;
  /** An in-process store (the default for a single process). */
  createLocalStore(): RateLimitStore;
}

/** Sessions over the backend configured in `system.session_store`. */
export interface SessionService {
  /**
   * A session manager whose store is chosen by core from `system.session_store`
   * (local files under `sessionsDir`, Deno KV or Redis) and scoped to this site
   * (`session_store.prefix`, `dune:<site id>` in multisite).
   */
  createManager(opts: { sessionsDir: string; lifetimeMs: number }): Promise<SessionManager>;
}

/** User accounts. */
export interface UserService {
  /** The flat-file user store under `usersDir` in the site's storage. */
  createLocalStore(opts: { usersDir: string }): UserStore;
}

/** Password hashing (PBKDF2, format `pbkdf2:<iterations>:<salt>:<key>`). */
export interface PasswordService {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  /** True if the stored hash is below the current cost and should be re-hashed on next login. */
  needsRehash(stored: string): boolean;
  /** A valid hash of nothing, to verify against for unknown users (equal-cost login). */
  readonly dummyHash: string;
}

/** Admin-tier access tuples (the authz system itself is created by bootstrap). */
export interface AuthzService {
  /**
   * Make sure every given user holds the tuple for their admin-tier role.
   * Idempotent. A no-op when the site has no authz system (admin disabled, or
   * `admin.authz_store` is not local).
   */
  seedAdminTuples(users: Array<{ id: string; role: string }>): Promise<void>;
}

/**
 * Long-lived engines core constructs once per site. The plugin uses them; it
 * does not build them, so state and on-disk layout stay under core's control.
 * They live under `admin.runtime_dir` (default `.dune/admin`).
 */
export interface EngineServices {
  /** Content status transitions, from `site.workflow`. */
  workflow: WorkflowEngine;
  /** Scheduled publish/unpublish store. CRUD only; the process that serves requests starts the polling loop. */
  scheduler: Scheduler;
  /** Staged drafts of published pages. */
  staging: StagingEngine;
  /** The configured machine translator, or null when none is configured. */
  mt: MachineTranslator | null;
  /** The audit trail, or null when `admin.audit.enabled` is false. */
  audit: AuditLogger | null;
}

/** The site's frontmatter schemas (blueprints), as currently loaded. */
export interface BlueprintService {
  /** True if the template has a blueprint. */
  has(template: string): boolean;
  /** The template's blueprint with its `extends` chain flattened, or null if it has none. */
  resolve(template: string): ResolvedBlueprint | null;
  /** Validate frontmatter against the template's blueprint. Empty means valid, or no blueprint. */
  validate(frontmatter: PageFrontmatter, template: string): BlueprintValidationError[];
}

/** Where a site keeps its data. Site-relative, as storage paths. */
export interface PathServices {
  /** The persistent data directory: `system.data_dir`, default `data`. */
  readonly dataDir: string;
  /** Plugin runtime state: `admin.runtime_dir`, default `.dune/admin`. */
  readonly runtimeDir: string;
}

/** Everything core hands a plugin. */
export interface PluginServices {
  security: SecurityService;
  rateLimit: RateLimitService;
  sessions: SessionService;
  users: UserService;
  passwords: PasswordService;
  logger: Logger;
  engines: EngineServices;
  authz: AuthzService;
  blueprints: BlueprintService;
  paths: PathServices;
}

/** Inputs core needs to build the services. */
export interface PluginServicesOptions {
  config: import("../config/types.ts").DuneConfig;
  storage: StorageAdapter;
  /** Site root. Needed for the audit trail's file path; without it `engines.audit` is null. */
  root?: string;
  /** The blueprints currently loaded by the content engine (read at call time; they reload). */
  getBlueprints?: () => BlueprintMap;
  /** Resolves the site's authz system once bootstrap has created it. */
  getAuthz?: () => { authz: DuneAuthSystem; adapter: AuthzLocalAdapter | AuthzDbAdapter } | undefined;
}
