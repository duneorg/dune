/**
 * GET /admin/api/content-editor/ws?path=... (Upgrade: websocket)
 *
 * Optional real-time WebSocket endpoint for plugin-provided content editors
 * (v0.24+). Core authenticates and validates the request, then delegates to
 * the plugin's `wsHandler`; the wire protocol on the socket is the plugin's.
 *
 * Returns 501 when no content editor plugin with a `wsHandler` is registered.
 */

import type { AdminState } from "../../../types.ts";
import { validatePagePath } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { contentEditor, auth } = ctx.state.adminContext;
    if (!contentEditor?.wsHandler) {
      return new Response("Content editor WebSocket not available", { status: 501 });
    }
    if (ctx.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const authResult = ctx.state.auth;
    if (!authResult?.authenticated || !authResult.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!auth.hasPermission(authResult, "pages.update")) {
      return new Response("Forbidden", { status: 403 });
    }

    const sourcePath = new URL(ctx.req.url).searchParams.get("path");
    if (!sourcePath || !validatePagePath(sourcePath)) {
      return new Response("Invalid path", { status: 400 });
    }

    return contentEditor.wsHandler!(ctx.req, {
      id: authResult.user.id,
      name: authResult.user.username,
    });
  },
};
