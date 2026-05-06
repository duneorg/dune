/** GET /admin/api/i18n/mt-status */


import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(_ctx: FreshContext<AdminState>) {
    const { mt } = getAdminContext();
    const enabled = mt != null;
    return json({ enabled, provider: enabled ? mt!.provider : null });
  },
};
