/**
 * `POST /auth/login`: sign a `provider: "local"` account in with a password.
 *
 * Public sites (admin disabled included) can have logged-in users through
 * OAuth and magic links; this is the third way in, for accounts created with a
 * password (`dune users:create`, or an admin). It is opt-in
 * (`site.auth.providers.password.enabled`).
 *
 * Safety, deliberately the same as the admin login:
 * - a password hash is always verified, against `DUMMY_HASH` when the account
 *   is unknown, disabled, not local or has no password, so a miss costs what a
 *   hit costs and every failure looks the same;
 * - one generic "Invalid credentials" for every failure;
 * - per-IP rate limit plus a per-identifier lockout, both counting unknown
 *   identifiers too, so the lockout leaks nothing about which accounts exist;
 * - same-origin check; `next` is only followed when it is a same-site path;
 * - hashes below the current cost are upgraded on success.
 *
 * @module
 */

import type { User } from "./types.ts";
import type { UserStore } from "./user-store.ts";
import type { SiteAuthMiddleware } from "./middleware.ts";
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from "./passwords.ts";
import { sanitizeNext } from "./redirect.ts";
import type { RateLimitStore } from "../security/rate-limit-store.ts";
import { clientIp } from "../security/rate-limit.ts";
import { checkSameOriginCsrf } from "../security/csrf.ts";
import { logger } from "../core/logger.ts";

/** Attempts per IP per window; successes count too. */
export const PASSWORD_LOGIN_IP_LIMIT = 10;
/** Failures per identifier per window before the identifier is locked. */
export const PASSWORD_LOGIN_LOCKOUT_THRESHOLD = 10;
/** The window for both limits. */
export const PASSWORD_LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MAX_IDENTIFIER_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;

/** Why the login page is showing an error. These values are part of the public surface (`?error=`). */
export type LoginError = "invalid" | "rate_limited";

/** The request body fields; names are part of the public surface. */
interface Credentials {
  identifier: string;
  password: string;
  next: string;
}

export interface PasswordLoginDeps {
  userStore: UserStore;
  middleware: SiteAuthMiddleware;
  rateLimitStore: RateLimitStore;
  trustForwardedFor: boolean;
  /** Where a failed attempt is sent back to (`site.auth.login_path`); default `/auth/login`. */
  loginPath?: string;
}

/** What the handler needs to show the login page again (a 429 renders it in place). */
export type RenderLogin = (
  view: { error: LoginError; next: string },
  status: number,
) => Promise<Response>;

function wantsJson(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

async function readCredentials(req: Request): Promise<Credentials | null> {
  try {
    if (wantsJson(req)) {
      const body = await req.json() as Record<string, unknown>;
      return {
        identifier: typeof body.identifier === "string" ? body.identifier.trim() : "",
        password: typeof body.password === "string" ? body.password : "",
        next: typeof body.next === "string" ? body.next : "",
      };
    }
    const form = await req.formData();
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    return { identifier: get("identifier").trim(), password: get("password"), next: get("next") };
  } catch {
    return null;
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Build the `POST /auth/login` handler. */
export function createPasswordLogin(deps: PasswordLoginDeps) {
  const { userStore, middleware, rateLimitStore, trustForwardedFor } = deps;
  const loginPath = deps.loginPath ?? "/auth/login";

  const fail = (
    req: Request,
    error: LoginError,
    next: string,
    render?: RenderLogin,
  ): Promise<Response> | Response => {
    const status = error === "rate_limited" ? 429 : 401;
    if (wantsJson(req)) {
      return json(
        { error: error === "rate_limited" ? "Too many attempts" : "Invalid credentials" },
        status,
        error === "rate_limited" ? { "Retry-After": String(PASSWORD_LOGIN_WINDOW_MS / 1000) } : {},
      );
    }
    if (error === "rate_limited") {
      // A redirect cannot carry a 429; show the page in place.
      return render ? render({ error, next }, 429) : new Response("Too many attempts", {
        status: 429,
        headers: { "Retry-After": String(PASSWORD_LOGIN_WINDOW_MS / 1000) },
      });
    }
    const location = `${loginPath}?error=invalid${
      next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""
    }`;
    return new Response(null, { status: 303, headers: { Location: location } });
  };

  return async function passwordLogin(req: Request, render?: RenderLogin): Promise<Response> {
    const csrf = checkSameOriginCsrf(req);
    if (csrf) return csrf;

    const ip = clientIp(req, { trustForwardedFor });
    const creds = await readCredentials(req);
    const next = sanitizeNext(creds?.next);

    // Per-IP limit first: it also bounds the cost of the PBKDF2 below. Requests with no
    // resolvable IP (unit tests, SSG) share one "unknown" bucket, which would let one
    // client lock everyone out, so they skip this limit like RateLimiter does; the
    // per-identifier lockout below still applies.
    if (ip !== "unknown") {
      const ipCheck = await rateLimitStore.check(
        `pw-login:ip:${ip}`,
        PASSWORD_LOGIN_IP_LIMIT,
        PASSWORD_LOGIN_WINDOW_MS,
      );
      if (!ipCheck.allowed) return fail(req, "rate_limited", next, render);
    }

    if (
      !creds || !creds.identifier || !creds.password ||
      creds.identifier.length > MAX_IDENTIFIER_LENGTH || creds.password.length > MAX_PASSWORD_LENGTH
    ) {
      return fail(req, "invalid", next, render);
    }

    const identifier = creds.identifier;
    const accountKey = `pw-login:id:${identifier.toLowerCase()}`;
    if (
      await rateLimitStore.isLocked(
        accountKey,
        PASSWORD_LOGIN_LOCKOUT_THRESHOLD,
        PASSWORD_LOGIN_WINDOW_MS,
      )
    ) {
      return fail(req, "rate_limited", next, render);
    }

    // An "@" means an email address; anything else is a username.
    let user: User | null = null;
    try {
      user = identifier.includes("@")
        ? await userStore.getByEmail(identifier.toLowerCase())
        : await userStore.getByUsername(identifier);
    } catch (err) {
      logger.error("auth.password.lookup_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Only an enabled local account with a password can sign in this way. Everything
    // else still pays for a full verification, against the dummy hash.
    const eligible = user !== null && user.enabled && user.provider === "local" &&
      !!user.passwordHash;
    const valid = await verifyPassword(creds.password, eligible ? user!.passwordHash! : DUMMY_HASH);

    if (!eligible || !valid) {
      await rateLimitStore.recordFailure(accountKey, PASSWORD_LOGIN_WINDOW_MS);
      logger.info("auth.password.failed", { ip: ip === "unknown" ? null : ip });
      return fail(req, "invalid", next, render);
    }

    const account = user!;
    await rateLimitStore.clearFailures(accountKey);

    // Upgrade a hash below the current cost; best effort, never fails the login.
    const patch: { lastSeenAt: number; passwordHash?: string } = { lastSeenAt: Date.now() };
    if (needsRehash(account.passwordHash!)) {
      try {
        patch.passwordHash = await hashPassword(creds.password);
      } catch { /* keep the old hash */ }
    }
    await userStore.update(account.id, patch).catch((err) =>
      logger.warn("auth.password.update_failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    const sessionId = await middleware.createSession(account.id, ip === "unknown" ? undefined : ip);
    const cookie = middleware.createSessionCookie(sessionId);
    logger.info("auth.password.login", { user: account.id });

    if (wantsJson(req)) {
      return json({ ok: true, next }, 200, { "Set-Cookie": cookie });
    }
    return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie } });
  };
}
