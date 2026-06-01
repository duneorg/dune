/** GET /admin/api/email-preview/:id — fetch a single intercepted email including HTML */

import { join } from "@std/path";
import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    if (Deno.env.get("DUNE_ENV") !== "dev") {
      return json({ error: "Email preview is only available in development mode" }, 404);
    }

    const id = ctx.params.id;
    if (!id || !/^[\w-]+$/.test(id)) {
      return json({ error: "Invalid id" }, 400);
    }

    const runtimeDir = ctx.state.adminContext.config.admin?.runtimeDir ?? ".dune/admin";
    const filePath = join(runtimeDir, "dev-email", `${id}.json`);

    try {
      const raw = await Deno.readTextFile(filePath);
      return json(JSON.parse(raw));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return json({ error: "Not found" }, 404);
      }
      return json({ error: "Failed to read email" }, 500);
    }
  },
};
