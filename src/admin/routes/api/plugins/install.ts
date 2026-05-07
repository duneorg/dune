/** POST /admin/api/plugins/install */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage } = ctx.state.adminContext;
    try {
      const { name, jsr } = await ctx.req.json() as { name?: string; jsr?: string };

      if (!name || typeof name !== "string") return json({ error: "Plugin name required" }, 400);
      if (!jsr || typeof jsr !== "string" || !jsr.startsWith("jsr:")) {
        return json({ error: "jsr specifier required (must start with jsr:)" }, 400);
      }
      // Require a pinned version. Without this, the installed plugin floats
      // on the registry and the next deploy may pull a different (potentially
      // hostile) build of the same name. jsr:@scope/name@1.2.3 is OK;
      // jsr:@scope/name without a version is rejected.
      // Allow: jsr:@scope/name@x.y.z, jsr:@scope/name@x.y.z-tag, with optional
      // sub-paths after the version (e.g. /mod.ts).
      const PINNED_JSR_RE = /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;
      if (!PINNED_JSR_RE.test(jsr)) {
        return json({
          error: "jsr specifier must be pinned to a specific version (e.g. jsr:@scope/name@1.2.3)",
        }, 400);
      }
      // Defence-in-depth: name and jsr go into site.yaml verbatim, so refuse
      // anything weird that could perturb YAML serialization.
      if (!/^[a-zA-Z0-9_@./-]{1,128}$/.test(name)) {
        return json({ error: "Plugin name has invalid characters" }, 400);
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
