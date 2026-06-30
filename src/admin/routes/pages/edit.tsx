/** GET /admin/pages/edit?path=... — delegates to the active ContentEditorPlugin */

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    return ctx.state.adminContext.contentEditor!.pageEditorHandler(ctx);
  },
};
