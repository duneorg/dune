/** GET + POST /admin/api/users */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { toUserInfo } from "../../../types.ts";
import { checkPasswordStrength } from "../../../../security/password-strength.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "users.read");
    if (denied) return denied;
    const { users } = getAdminContext();
    try {
      const all = await users.list();
      return json({ items: all.map(toUserInfo), total: all.length });
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "users.create");
    if (denied) return denied;

    const { users, auditLogger } = getAdminContext();
    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { username, email, password, role, name } = body;

      if (!username || !password || !role) {
        return json({ error: "username, password, and role are required" }, 400);
      }

      const strength = checkPasswordStrength(password);
      if (!strength.ok) return json({ error: strength.reason }, 400);

      const VALID_ROLES = ["admin", "editor", "author"] as const;
      if (!VALID_ROLES.includes(role)) {
        return json({ error: `Invalid role: must be one of ${VALID_ROLES.join(", ")}` }, 400);
      }
      if (role === "admin" && authResult.user?.role !== "admin") {
        return json({ error: "Only admins can create admin-role users" }, 403);
      }

      const existing = await users.getByUsername(username);
      if (existing) return json({ error: "Username already exists" }, 409);

      const user = await users.create({
        username,
        email: email ?? "",
        password,
        role,
        name: name ?? username,
      });

      void auditLogger?.log({
        event: "user.create",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: user.id },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ created: true, user: toUserInfo(user) }, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
