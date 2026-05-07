/** POST /admin/api/themes/install */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { assertOutboundUrlAllowed } from "../../../../security/ssrf.ts";
import type { FreshContext } from "fresh";

interface RegistryTheme {
  slug: string;
  name?: string;
  downloadUrl?: string;
  /** Optional SHA-256 of the theme ZIP, hex-encoded. */
  sha256?: string;
}

async function loadRegistry(): Promise<RegistryTheme[]> {
  try {
    const registryUrl = new URL("../../../registry/themes.json", import.meta.url);
    const raw = await Deno.readTextFile(registryUrl);
    const reg = JSON.parse(raw) as { themes?: RegistryTheme[] };
    return reg.themes ?? [];
  } catch {
    return [];
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { storage } = ctx.state.adminContext;
    try {
      // Caller-supplied downloadUrl is no longer trusted — themes are
      // resolved exclusively by slug against the local registry. This
      // closes a vector where any user with config.update could install
      // an arbitrary HTTPS ZIP from any host.
      const { slug } = await ctx.req.json() as { slug?: string };

      if (!slug || typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
        return json({ error: "Invalid slug — must match [a-z0-9][a-z0-9_-]*" }, 400);
      }

      const registry = await loadRegistry();
      const entry = registry.find((t) => t.slug === slug);
      if (!entry || typeof entry.downloadUrl !== "string") {
        return json({ error: `Theme "${slug}" not found in local registry` }, 404);
      }

      // Even though the URL comes from a trusted local registry, run the
      // SSRF guard so a registry typo can't be a foothold and so an
      // operator who packages a custom registry can't accidentally host
      // their feed at an internal address.
      try {
        await assertOutboundUrlAllowed(entry.downloadUrl);
      } catch (err) {
        return json({ error: `Refusing theme download: ${err instanceof Error ? err.message : String(err)}` }, 400);
      }

      const fetchResp = await fetch(entry.downloadUrl, {
        headers: { "User-Agent": "Dune-CMS/1.0 theme-installer" },
        redirect: "manual",
      });
      if (!fetchResp.ok) {
        return json({ error: `Failed to fetch theme ZIP: HTTP ${fetchResp.status}` }, 502);
      }

      const zipBytes = new Uint8Array(await fetchResp.arrayBuffer());
      // Verify SHA-256 if the registry pinned one. Pinned hashes block a
      // compromised CDN or upstream from substituting a malicious ZIP.
      if (entry.sha256) {
        const got = await sha256Hex(zipBytes);
        if (got.toLowerCase() !== entry.sha256.toLowerCase()) {
          return json({
            error: `Theme integrity check failed: expected ${entry.sha256}, got ${got}`,
          }, 502);
        }
      }
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
