/** PUT + DELETE /admin/api/users/:id */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../../_utils.ts";
import { toUserInfo } from "../../../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "users.update");
    if (denied) return denied;

    const { users, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const userId = ctx.params.id;

    try {
      const body = await ctx.req.json();
      const { name, email, role, enabled } = body;

      if (role !== undefined && authResult.user?.role !== "admin") {
        return json({ error: "Only admins can change user roles" }, 403);
      }
      if (role === "admin" && authResult.user?.role !== "admin") {
        return json({ error: "Only admins can assign admin role" }, 403);
      }
      if (role !== undefined) {
        const VALID_ROLES = ["admin", "editor", "author"] as const;
        if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
      }

      const updates: Partial<{ name: string; email: string; role: "admin" | "editor" | "author"; enabled: boolean }> = {};
      if (name !== undefined) updates.name = String(name);
      if (email !== undefined) updates.email = String(email);
      if (role !== undefined) updates.role = role;
      if (enabled !== undefined) updates.enabled = Boolean(enabled);

      const updated = await users.update(userId, updates);
      if (!updated) return json({ error: "User not found" }, 404);

      void auditLogger?.log({
        event: "user.update",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: userId },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true, user: toUserInfo(updated) });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "users.delete");
    if (denied) return denied;

    const { users, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const userId = ctx.params.id;

    try {
      if (authResult.user?.id === userId) {
        return json({ error: "Cannot delete your own account" }, 400);
      }
      const deleted = await users.delete(userId);
      if (!deleted) return json({ error: "User not found" }, 404);

      void auditLogger?.log({
        event: "user.delete",
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
