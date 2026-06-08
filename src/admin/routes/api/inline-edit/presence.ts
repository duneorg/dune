/**
 * GET /admin/api/inline-edit/presence
 *
 * Returns live presence data — which pages currently have active inline
 * editing sessions and who is in them.
 *
 * Response:
 * ```json
 * {
 *   "presence": [
 *     {
 *       "sourcePath": "pages/about/default.md",
 *       "editors": [
 *         { "userId": "abc123", "name": "alice", "color": "#3498db" }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * Used by the PageTree island to show "N editing" badges on the pages list.
 * Polled every 30 seconds; no WebSocket needed for this low-frequency signal.
 */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { inlineEdit } = ctx.state.adminContext;
    if (!inlineEdit) return json({ presence: [] });

    return json({ presence: inlineEdit.getPresence() });
  },
};
