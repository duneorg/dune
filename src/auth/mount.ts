/**
 * Public auth mount — wires the auth subsystem into a Fresh app.
 *
 * Usage pattern mirrors src/admin/mount.ts. Call mountDuneAuth(app, ctx)
 * after mountDuneAdmin(), which registers:
 *   - A middleware that sets ctx.state.siteUser on every request
 *   - Auth routes under /auth/
 *
 * The middleware runs unconditionally — individual routes decide what to do
 * with a null siteUser.
 */

// deno-lint-ignore no-explicit-any
import type { App } from "fresh";
import type { BootstrapResult } from "../cli/bootstrap.ts";
import { createLocalSiteUserStore } from "./user-store.ts";
import { createSiteAuthMiddleware, createSiteSessionManager } from "./middleware.ts";
import { createAuthRoutes } from "./routes.ts";
import { createProviders } from "./providers/mod.ts";
import { SITE_USER_HEADER, type SiteUser } from "./types.ts";
import { InMemoryMagicTokenStore } from "./magic-link.ts";
import { createDuneAuthSystem, bootstrapRoleTuples } from "./authz.ts";
import type { DuneAuthSystem } from "./authz.ts";
import type { AuthzLocalAdapter } from "./authz-adapter-local.ts";
import { setGatingAuthz } from "./gating.ts";

// deno-lint-ignore no-explicit-any
type FreshApp = App<any>;

export interface PublicAuthContext {
  /** Resolve the current site user from a request (null if not authenticated) */
  resolveUser: (req: Request) => Promise<SiteUser | null>;
  /**
   * The configured authz system, or null in external-jwt mode.
   * Pass to `mountPaymentRoutes()` so the payment manager can call
   * `authz.addMember()` when a role is granted after a successful payment.
   */
  authz: DuneAuthSystem | null;
}

/**
 * Mount the public auth subsystem onto a Fresh app.
 *
 * Reads `site.auth` from the bootstrapped config. If auth is not configured
 * this is a safe no-op — ctx.state.siteUser will always be null.
 */
export async function mountDuneAuth(
  app: FreshApp,
  ctx: BootstrapResult,
): Promise<PublicAuthContext> {
  const { config, storage } = ctx;
  const authConfig = (config.site as any).auth as SiteAuthConfig | undefined;

  const adminCfg = config.admin ?? { dataDir: "data", runtimeDir: ".dune/admin" };
  const dataDir = adminCfg.dataDir ?? "data";
  const runtimeDir = adminCfg.runtimeDir ?? ".dune/admin";

  const mode = authConfig?.mode ?? "dune";
  const sessionLifetimeSec = authConfig?.sessionLifetime ?? 30 * 24 * 60 * 60;
  const userStoreType = authConfig?.userStore ?? "local";
  const trustForwardedFor = config.system?.trusted_proxies === true;
  const secureCookies = Deno.env.get("DUNE_ENV") !== "dev";
  const siteUrl = config.site.url.replace(/\/$/, "");

  // ── User store ──────────────────────────────────────────────────────────────
  const usersDir = `${dataDir}/site-users`;
  const userStore = createLocalSiteUserStore({ storage, usersDir });

  // ── Session manager ─────────────────────────────────────────────────────────
  // Site sessions stored under a separate directory from admin sessions
  const sessionsDir = `${runtimeDir}/site-sessions`;
  const sessionMgr = createSiteSessionManager({
    storage,
    sessionsDir,
    lifetime: sessionLifetimeSec,
  });

  // ── Auth middleware ─────────────────────────────────────────────────────────
  const jwtOpts = mode === "external-jwt" && authConfig?.jwt
    ? authConfig.jwt
    : undefined;

  const authMiddleware = createSiteAuthMiddleware({
    userStore,
    sessions: sessionMgr,
    mode,
    jwt: jwtOpts,
    secure: secureCookies,
    sessionLifetime: sessionLifetimeSec,
    trustForwardedFor,
  });

  // ── Authorization (polizy) ─────────────────────────────────────────────────
  // Local polizy authz is the default in "dune" mode and an explicit opt-in in
  // "external-jwt" mode (set authzStore: local in site.yaml to enable).
  //
  // external-jwt + authzStore:local — JWT claims seed initial group-membership
  // tuples on first user appearance; polizy is the authority from that point.
  // Role changes in the external IdP are NOT auto-synced — wire a webhook to
  // authz.addMember() / authz.disallowAllMatching() to keep them in sync.
  // Stale tuples for deleted users are bounded by the JWT TTL (tokens expire,
  // so deleted users cannot present a valid JWT to reach gated content).
  //
  // When bootstrap() already created the authz bundle (the normal full-stack path),
  // reuse it so admin-user and site-user tuples share the same in-memory index.
  // For headless setups that call mountDuneAuth() without a prior bootstrap()
  // (e.g. testing or custom servers), a fresh bundle is created here.
  let mountAuthz: DuneAuthSystem | null = null;
  let mountAdapter: AuthzLocalAdapter | null = null;

  const authzStoreCfg = mode === "dune"
    ? (authConfig?.authzStore ?? "local")   // default local in dune mode
    : authConfig?.authzStore;               // must be explicit in external-jwt mode

  if (authzStoreCfg === "local") {
    const existingAuthz = ctx.authz as DuneAuthSystem | undefined;
    const existingAdapter = ctx.authzAdapter as AuthzLocalAdapter | undefined;
    const bundle = (existingAuthz && existingAdapter)
      ? { authz: existingAuthz, adapter: existingAdapter }
      : createDuneAuthSystem({ authzStore: "local", dataDir }, storage);

    setGatingAuthz(bundle.authz);
    mountAuthz = bundle.authz;
    mountAdapter = bundle.adapter;

    if (mode === "dune") {
      // Bulk-bootstrap from existing site users' roles[] — idempotent.
      // In external-jwt mode users are lazily provisioned per-request instead.
      try {
        const allUsers = await userStore.list();
        await bootstrapRoleTuples(bundle.authz, bundle.adapter, allUsers);
      } catch {
        // Bootstrap failure must not prevent startup — gating falls back to array check
      }
    }
  }

  // ── OAuth providers ─────────────────────────────────────────────────────────
  const providersCfg = authConfig?.providers ?? {};
  const providers = createProviders({
    github: providersCfg.github,
    google: providersCfg.google,
    discord: providersCfg.discord,
  });

  // ── Magic link ─────────────────────────────────────────────────────────────
  const magicEnabled = authConfig?.providers?.magicLink?.enabled === true && mode === "dune";
  const envSecret = Deno.env.get("DUNE_AUTH_SECRET");

  if (magicEnabled && !envSecret) {
    // Magic links are HMAC-signed with this secret. An insecure default allows
    // anyone who knows the default to forge magic link tokens.
    throw new Error(
      "[dune/auth] Magic links are enabled but DUNE_AUTH_SECRET is not set. " +
        "Set DUNE_AUTH_SECRET to a cryptographically random secret of at least " +
        "32 bytes before enabling magic links in production.",
    );
  }

  // Fall back to an empty string only in code paths where magicEnabled is false
  // (the token store and sign function will not be called).
  const magicSecret = envSecret ?? "";

  // ── Email sender ────────────────────────────────────────────────────────────
  // Reuse the admin SMTP config if present, same pattern as admin/email.ts
  let sendEmail: ((to: string, subject: string, text: string, html: string) => Promise<void>) | undefined;
  if (magicEnabled) {
    const smtpCfg = (config as any).admin?.notifications?.email?.smtp;
    if (smtpCfg) {
      // Lazy import to avoid pulling in nodemailer when not used
      const { default: nodemailer } = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: smtpCfg.host,
        port: smtpCfg.port,
        secure: smtpCfg.secure,
        auth: {
          user: expandEnv(smtpCfg.user),
          pass: expandEnv(smtpCfg.pass),
        },
      });
      const from = (config as any).admin?.notifications?.email?.from ?? `noreply@${new URL(siteUrl).hostname}`;
      sendEmail = async (to, subject, text, html) => {
        await transporter.sendMail({ from, to, subject, text, html });
      };
    }
  }

  // ── Magic token store (single-use enforcement) ─────────────────────────────
  // Use an in-memory store by default. Multi-process deployments should inject
  // a shared store (KV, Redis) via the authConfig extension points.
  const magicTokenStore = magicEnabled ? new InMemoryMagicTokenStore() : undefined;

  // ── Routes ─────────────────────────────────────────────────────────────────
  const routes = createAuthRoutes({
    userStore,
    middleware: authMiddleware,
    providers,
    magicLinkEnabled: magicEnabled,
    magicLinkSecret: magicSecret,
    siteUrl,
    mode,
    sendEmail,
    trustForwardedFor,
    magicTokenStore,
  });

  // ── Register global middleware — populates ctx.state.siteUser ───────────────
  //
  // Security: strip any externally-supplied x-dune-site-user header before
  // resolving the user from the session/JWT. Without this an external caller
  // could forge the header and impersonate any site user in handlers that read
  // it via getSiteUser() or requireAuth().
  //
  // After resolving the real user, inject the header back so that downstream
  // plain-Request handlers (content gating, API guards, payment routes) can
  // read the verified user without access to Fresh's ctx.state.

  // Track external-jwt users provisioned this process lifetime.
  // Prevents re-provisioning on every request; hasTuple() idempotency in the
  // adapter prevents duplicate tuples across process restarts.
  const externalUsersProvisioned = new Set<string>();

  app.use(async (fc) => {
    // Build a clean header set with any externally-supplied header removed.
    const cleanHeaders = new Headers(fc.req.headers);
    cleanHeaders.delete(SITE_USER_HEADER);
    const cleanReq = new Request(fc.req, { headers: cleanHeaders });

    // Resolve the real user from the session cookie / JWT only.
    const user = await authMiddleware.resolveUser(cleanReq);

    // Lazy-provision polizy tuples for external-jwt users on first appearance.
    // JWT role claims seed initial group memberships so that authz.check() and
    // content gating work without manual tuple management. Awaited so the user
    // has correct permissions on their very first request.
    if (user && mountAuthz && mountAdapter && mode === "external-jwt") {
      if (!externalUsersProvisioned.has(user.id)) {
        externalUsersProvisioned.add(user.id);
        await bootstrapRoleTuples(mountAuthz, mountAdapter, [user]).catch(() => {});
      }
    }

    // Re-inject the resolved user so downstream handlers can call getSiteUser(req).
    if (user) {
      cleanHeaders.set(SITE_USER_HEADER, JSON.stringify(user));
    }
    // Replace the request on the context so all downstream handlers see the
    // sanitised + enriched version.
    (fc as any).req = new Request(fc.req, { headers: cleanHeaders });

    (fc.state as any).siteUser = user;
    return fc.next();
  });

  // ── Register auth routes ────────────────────────────────────────────────────

  // GET /auth/login
  app.get("/auth/login", (fc) => {
    const siteUser = (fc.state as any).siteUser as SiteUser | null;
    return routes.login(fc.req, siteUser);
  });

  // GET /auth/logout
  app.get("/auth/logout", (fc) => routes.logout(fc.req));

  // GET /auth/me
  app.get("/auth/me", (fc) => {
    const siteUser = (fc.state as any).siteUser as SiteUser | null;
    return routes.me(fc.req, siteUser);
  });

  // POST /auth/magic/send
  app.post("/auth/magic/send", (fc) => routes.magicSend(fc.req));

  // GET /auth/magic (token validation)
  app.get("/auth/magic", (fc) => routes.magicVerify(fc.req));

  // GET /auth/{provider} — initiate OAuth
  // GET /auth/{provider}/callback — OAuth callback
  // Fresh doesn't have wildcard sub-path matching cleanly, so register each configured provider
  for (const [providerName] of providers) {
    const pName = providerName; // capture for closure
    app.get(`/auth/${pName}`, (fc) => routes.oauthStart(fc.req, pName));
    app.get(`/auth/${pName}/callback`, (fc) => routes.oauthCallback(fc.req, pName));
  }

  return {
    resolveUser: (req) => authMiddleware.resolveUser(req),
    authz: mountAuthz,
  };
}

function expandEnv(value: string): string {
  if (typeof value === "string" && value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}

// ── Config types (inline — avoid circular import with config/types.ts) ────────

interface SiteAuthConfig {
  mode?: "dune" | "external-jwt";
  providers?: {
    github?: { clientId: string; clientSecret: string };
    google?: { clientId: string; clientSecret: string };
    discord?: { clientId: string; clientSecret: string };
    magicLink?: { enabled: boolean };
  };
  jwt?: {
    secret?: string;
    jwksUrl?: string;
    userIdClaim?: string;
    emailClaim?: string;
    rolesClaim?: string;
  };
  sessionLifetime?: number;
  userStore?: "local";
  /** Storage tier for permission tuples. Default: "local". */
  authzStore?: "local";
}
