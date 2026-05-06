/** GET + POST + DELETE /admin/api/i18n/memory */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import { loadTM, saveTM } from "../../../../tm.ts";
import type { FreshContext } from "fresh";

function isValidLang(lang: unknown, supported: string[]): lang is string {
  return typeof lang === "string" && supported.includes(lang);
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { storage, config } = getAdminContext();
    try {
      const supported = config.system.languages?.supported ?? [];
      const from = ctx.url.searchParams.get("from");
      const to = ctx.url.searchParams.get("to");
      if (!isValidLang(from, supported) || !isValidLang(to, supported)) {
        return json({ error: "Valid from and to language codes required" }, 400);
      }
      const contentDir = config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      const entries = Object.entries(tm)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, target]) => ({ source, target }));
      return json({ from, to, entries });
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { storage, config } = getAdminContext();
    try {
      const supported = config.system.languages?.supported ?? [];
      const body = await ctx.req.json();
      const { from, to, source, target } = body;
      if (!isValidLang(from, supported) || !isValidLang(to, supported)) {
        return json({ error: "Valid from and to language codes required" }, 400);
      }
      if (!source || typeof source !== "string" || !target || typeof target !== "string") {
        return json({ error: "source and target strings required" }, 400);
      }
      const contentDir = config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      tm[source.trim()] = target.trim();
      await saveTM(storage, contentDir, from, to, tm);
      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const { storage, config } = getAdminContext();
    try {
      const supported = config.system.languages?.supported ?? [];
      const body = await ctx.req.json();
      const { from, to, source } = body;
      if (!isValidLang(from, supported) || !isValidLang(to, supported)) {
        return json({ error: "Valid from and to language codes required" }, 400);
      }
      if (!source || typeof source !== "string") {
        return json({ error: "source string required" }, 400);
      }
      const contentDir = config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      delete tm[source];
      await saveTM(storage, contentDir, from, to, tm);
      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
