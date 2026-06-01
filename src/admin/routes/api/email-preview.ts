/** GET /admin/api/email-preview — list dev-mode intercepted emails */

import { join } from "@std/path";
import type { AdminState } from "../../types.ts";
import { json } from "./_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    if (Deno.env.get("DUNE_ENV") !== "dev") {
      return json({ error: "Email preview is only available in development mode" }, 404);
    }

    const runtimeDir = ctx.state.adminContext.config.admin?.runtimeDir ?? ".dune/admin";
    const devEmailDir = join(runtimeDir, "dev-email");

    let entries: Record<string, unknown>[] = [];

    try {
      for await (const entry of Deno.readDir(devEmailDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        try {
          const raw = await Deno.readTextFile(join(devEmailDir, entry.name));
          const record = JSON.parse(raw);
          // Omit the html body from the list — returned on the detail request
          const { html: _html, text: _text, ...meta } = record;
          entries.push(meta);
        } catch {
          // Skip malformed files
        }
      }
    } catch (err) {
      // Directory doesn't exist yet — no emails captured
      if (!(err instanceof Deno.errors.NotFound)) {
        return json({ error: "Failed to read dev-email directory" }, 500);
      }
    }

    // Sort newest first
    entries.sort((a, b) => ((b.timestamp as number) ?? 0) - ((a.timestamp as number) ?? 0));

    return json({ emails: entries });
  },
};
