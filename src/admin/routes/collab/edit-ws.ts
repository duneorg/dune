/**
 * GET /admin/collab/edit-ws?path=... (Upgrade: websocket)
 *
 * Real-time inline editing WebSocket endpoint (v0.16+). Core authenticates
 * and validates the request, then hands the upgrade to the plugin-provided
 * InlineEditManager; the sync protocol on the socket is the plugin's.
 *
 * The `path` query parameter is the page source path relative to the content
 * directory, e.g. `pages/about/default.md`.
 */

import type { AdminState } from "../../types.ts";
import { validatePagePath } from "../api/_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { inlineEdit, auth } = ctx.state.adminContext;
    if (!inlineEdit) {
      return new Response("Inline editing not enabled", { status: 501 });
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

    // Validate path here (in admin context where validatePagePath is available)
    // so manager.ts doesn't need a weaker hand-rolled check.
    const sourcePath = new URL(ctx.req.url).searchParams.get("path");
    if (!sourcePath || !validatePagePath(sourcePath)) {
      return new Response("Invalid path", { status: 400 });
    }

    return inlineEdit.handleUpgrade(ctx.req, {
      id: authResult.user.id,
      name: authResult.user.username,
    });
  },
};
