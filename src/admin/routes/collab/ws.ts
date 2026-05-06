/**
 * GET /admin/collab/ws?docId=... (Upgrade: websocket)
 * Real-time collaborative editing WebSocket endpoint.
 */


import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { collab } = getAdminContext();
    if (!collab) {
      return new Response("Collaboration not enabled", { status: 501 });
    }
    if (ctx.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const docId = ctx.url.searchParams.get("docId");
    if (!docId) {
      return new Response("Missing docId", { status: 400 });
    }
    const authResult = ctx.state.auth;
    if (!authResult?.authenticated || !authResult.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    return collab.handleUpgrade(ctx.req, authResult.user);
  },
};
