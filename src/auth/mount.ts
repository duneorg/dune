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
import type { SiteUser } from "./types.ts";

// deno-lint-ignore no-explicit-any
type FreshApp = App<any>;

export interface PublicAuthContext {
  /** Resolve the current site user from a request (null if not authenticated) */
  resolveUser: (req: Request) => Promise<SiteUser | null>;
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

  // ── OAuth providers ─────────────────────────────────────────────────────────
  const providersCfg = authConfig?.providers ?? {};
  const providers = createProviders({
    github: providersCfg.github,
    google: providersCfg.google,
    discord: providersCfg.discord,
  });

  // ── Magic link ─────────────────────────────────────────────────────────────
  const magicEnabled = authConfig?.providers?.magicLink?.enabled === true && mode === "dune";
  // Default secret from env for convenience; prod deployments should set auth.jwt.secret or
  // a dedicated magic link secret in site.yaml / environment.
  const magicSecret = Deno.env.get("DUNE_AUTH_SECRET") ?? "insecure-default-change-in-production";

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
  });

  // ── Register global middleware — populates ctx.state.siteUser ───────────────
  app.use(async (fc) => {
    (fc.state as any).siteUser = await authMiddleware.resolveUser(fc.req);
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
}
