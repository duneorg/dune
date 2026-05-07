/**
 * GET /admin/collab/ws?docId=... (Upgrade: websocket)
 * Real-time collaborative editing WebSocket endpoint.
 */

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { collab, auth } = ctx.state.adminContext;
    if (!collab) {
      return new Response("Collaboration not enabled", { status: 501 });
    }
    if (ctx.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Origin check: cross-site pages can attempt WebSocket upgrades with
    // cookies attached (CSWSH). Reject any upgrade whose Origin doesn't
    // match the request host. This is the defence-in-depth equivalent of
    // the CSRF Origin check applied to admin API mutations.
    const origin = ctx.req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== ctx.url.host) {
          return new Response("Cross-origin WebSocket rejected", { status: 403 });
        }
      } catch {
        return new Response("Cross-origin WebSocket rejected", { status: 403 });
      }
    }

    const docId = ctx.url.searchParams.get("docId");
    if (!docId) {
      return new Response("Missing docId", { status: 400 });
    }
    const authResult = ctx.state.auth;
    if (!authResult?.authenticated || !authResult.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    // Per-document authorization: bind WebSocket access to the same
    // permission a non-realtime page edit would require.
    if (!auth.hasPermission(authResult, "pages.update")) {
      return new Response("Forbidden", { status: 403 });
    }
    return collab.handleUpgrade(ctx.req, authResult.user);
  },
};
