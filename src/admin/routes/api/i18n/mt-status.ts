/** GET /admin/api/i18n/mt-status */

import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { mt } = ctx.state.adminContext;
    const enabled = mt != null;
    return json({ enabled, provider: enabled ? mt!.provider : null });
  },
};
