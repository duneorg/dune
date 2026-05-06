/** POST /admin/api/themes/install */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage, engine } = ctx.state.adminContext;
    try {
      const { slug, downloadUrl } = await ctx.req.json() as { slug?: string; downloadUrl?: string };

      if (!slug || typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
        return json({ error: "Invalid slug — must match [a-z0-9][a-z0-9_-]*" }, 400);
      }
      if (!downloadUrl || typeof downloadUrl !== "string") {
        return json({ error: "downloadUrl required" }, 400);
      }
      if (!downloadUrl.startsWith("https://")) {
        return json({ error: "downloadUrl must be an https:// URL" }, 400);
      }

      const fetchResp = await fetch(downloadUrl, {
        headers: { "User-Agent": "Dune-CMS/1.0 theme-installer" },
      });
      if (!fetchResp.ok) {
        return json({ error: `Failed to fetch theme ZIP: HTTP ${fetchResp.status}` }, 502);
      }

      const zipBytes = new Uint8Array(await fetchResp.arrayBuffer());
      const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip-js/zip-js");
      const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
      const entries = await zipReader.getEntries();

      const destPrefix = `themes/${slug}/`;
      let filesWritten = 0;

      for (const entry of entries) {
        if (entry.directory) continue;
        let filename = entry.filename.replace(/^[^/]+\//, "");
        if (filename.includes("..") || filename.startsWith("/")) continue;
        const data = await entry.getData!(new Uint8ArrayWriter());
        await storage.write(`${destPrefix}${filename}`, data);
        filesWritten++;
      }

      await zipReader.close();
      console.log(`  📦 Installed theme "${slug}" (${filesWritten} files)`);
      return json({ success: true, slug, filesWritten });
    } catch (err) {
      return serverError(err);
    }
  },
};
