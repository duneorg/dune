/** POST /admin/api/plugins/install */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage } = getAdminContext();
    try {
      const { name, jsr } = await ctx.req.json() as { name?: string; jsr?: string };

      if (!name || typeof name !== "string") return json({ error: "Plugin name required" }, 400);
      if (!jsr || typeof jsr !== "string" || !jsr.startsWith("jsr:")) {
        return json({ error: "jsr specifier required (must start with jsr:)" }, 400);
      }

      const siteRaw = await storage.readText("config/site.yaml").catch(() => "");
      const site = (parseYaml(siteRaw || "") ?? {}) as Record<string, unknown>;
      const existingList = Array.isArray(site.plugins) ? (site.plugins as Array<Record<string, unknown>>) : [];

      const alreadyInstalled = existingList.some(
        (p) => typeof p === "object" && p !== null && (p.src === jsr || p.src === name),
      );
      if (alreadyInstalled) return json({ installed: false, reason: "already installed" });

      const updatedSite = { ...site, plugins: [...existingList, { src: jsr }] };
      await storage.write("config/site.yaml", stringifyYaml(updatedSite).trimEnd() + "\n");

      console.log(`  🔌 Plugin "${name}" (${jsr}) added to site.yaml`);
      return json({ installed: true, name, jsr });
    } catch (err) {
      return serverError(err);
    }
  },
};
