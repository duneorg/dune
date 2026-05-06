/** POST /admin/api/users/:id/password */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import { checkPasswordStrength } from "../../../../../security/password-strength.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "users.update");
    if (denied) return denied;

    const { users, auditLogger } = getAdminContext();
    const authResult = ctx.state.auth;
    const userId = ctx.params.id;

    try {
      const { password } = await ctx.req.json();
      const strength = checkPasswordStrength(password);
      if (!strength.ok) return json({ error: strength.reason }, 400);

      const changed = await users.changePassword(userId, password);
      if (!changed) return json({ error: "User not found" }, 404);

      void auditLogger?.log({
        event: "user.password",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: userId },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
