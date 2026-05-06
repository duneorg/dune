/** PUT /admin/api/media/meta */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { dirname } from "@std/path";
import { stringify as stringifyYaml, parse as parseYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

export const handler = {
  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "media.upload");
    if (denied) return denied;

    const { storage, config } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json();
      const { pagePath, name, focal } = body;

      if (!pagePath || typeof pagePath !== "string" || !name || typeof name !== "string") {
        return json({ error: "pagePath and name required" }, 400);
      }

      if (focal !== null && focal !== undefined) {
        if (!Array.isArray(focal) || focal.length !== 2 ||
          typeof focal[0] !== "number" || typeof focal[1] !== "number" ||
          focal[0] < 0 || focal[0] > 100 || focal[1] < 0 || focal[1] > 100) {
          return json({ error: "focal must be [x, y] with values 0–100" }, 400);
        }
      }

      const contentDir = config.system.content.dir;
      const sidecarPath = `${contentDir}/${dirname(pagePath)}/${name}.meta.yaml`;

      if (focal === null || focal === undefined) {
        let existing: Record<string, unknown> = {};
        try {
          const raw = await storage.read(sidecarPath);
          existing = (parseYaml(new TextDecoder().decode(raw)) as Record<string, unknown>) ?? {};
        } catch { return json({ ok: true }); }
        delete existing.focal;
        if (Object.keys(existing).length === 0) {
          try { await storage.delete(sidecarPath); } catch { /* already gone */ }
        } else {
          await storage.write(sidecarPath, new TextEncoder().encode(stringifyYaml(existing)));
        }
      } else {
        let existing: Record<string, unknown> = {};
        try {
          const raw = await storage.read(sidecarPath);
          existing = (parseYaml(new TextDecoder().decode(raw)) as Record<string, unknown>) ?? {};
        } catch { /* new sidecar */ }
        existing.focal = focal;
        await storage.write(sidecarPath, new TextEncoder().encode(stringifyYaml(existing)));
      }

      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
