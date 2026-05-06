/** GET /admin/api/audit */


import type { AdminState } from "../../types.ts";
import { json } from "./_utils.ts";
import { getAdminContext } from "../../context.ts";
import type { AuditQuery, AuditEventType } from "../../../audit/mod.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { auditLogger } = getAdminContext();
    if (ctx.state.auth.user?.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }
    if (!auditLogger) return json({ error: "Audit logging not enabled" }, 501);

    const q: AuditQuery = {};
    const p = ctx.url.searchParams;
    const limit = p.get("limit");
    const offset = p.get("offset");
    const event = p.get("event");
    const actorId = p.get("actorId");
    const from = p.get("from");
    const to = p.get("to");
    const outcome = p.get("outcome");

    if (limit) q.limit = parseInt(limit, 10);
    if (offset) q.offset = parseInt(offset, 10);
    if (event) q.event = event as AuditEventType;
    if (actorId) q.actorId = actorId;
    if (from) q.from = from;
    if (to) q.to = to;
    if (outcome === "success" || outcome === "failure") q.outcome = outcome;

    const result = await auditLogger.query(q);
    return json(result);
  },
};
