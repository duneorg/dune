/**
 * POST /admin/login/logout — revoke session and redirect to login.
 * Split into its own route so the layout's sign-out form can POST here.
 */

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";
import { csrfCheck } from "../api/_utils.ts";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    // Defence-in-depth (LOW-1): SameSite=Lax cookies already block third-
    // party POST forms from forging logout, but an explicit Origin check
    // matches the rest of the mutating admin surface and protects against
    // browser policy regressions.
    const csrfDenied = csrfCheck(ctx);
    if (csrfDenied) return csrfDenied;

    const { auth, sessions, prefix, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    if (authResult?.session) {
      await sessions.revoke(authResult.session.id);
      if (authResult.user) {
        void auditLogger?.log({
          event: "auth.logout",
          actor: { userId: authResult.user.id, username: authResult.user.username, name: authResult.user.name },
          ip: null,
          userAgent: ctx.req.headers.get("user-agent"),
          target: null,
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${prefix}/login`,
        "Set-Cookie": auth.clearSessionCookie(),
      },
    });
  },
};
