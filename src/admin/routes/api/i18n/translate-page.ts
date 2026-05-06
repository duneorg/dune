/** POST /admin/api/i18n/translate-page */

import type { AdminState } from "../../../types.ts";
import { json, serverError, csrfCheck } from "../_utils.ts";
import { dirname, basename } from "@std/path";
import { parseContentFilename } from "../../../../content/path-utils.ts";
import type { FreshContext } from "fresh";

function splitFrontmatter(content: string): { fm: string; body: string } {
  if (!content.startsWith("---")) return { fm: "", body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: content };
  return { fm: content.slice(0, end + 4), body: content.slice(end + 4) };
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;

    const { mt, storage, config, engine } = ctx.state.adminContext;
    if (!mt) return json({ error: "Machine translation not configured" }, 501);

    try {
      const { sourcePath, targetLang } = await ctx.req.json();
      if (!sourcePath || typeof sourcePath !== "string" || !targetLang || typeof targetLang !== "string") {
        return json({ error: "sourcePath and targetLang required" }, 400);
      }

      const supported = config.system.languages?.supported ?? [];
      if (!supported.includes(targetLang)) return json({ error: "Unsupported target language" }, 400);

      const defaultLang = config.system.languages?.default ?? "en";
      const contentDir = config.system.content.dir;

      let sourceText: string;
      try {
        sourceText = await storage.readText(`${contentDir}/${sourcePath}`);
      } catch {
        return json({ error: "Source file not found" }, 404);
      }

      const { fm, body } = splitFrontmatter(sourceText);

      let translatedBody: string;
      try {
        translatedBody = await mt.translate(body, defaultLang, targetLang);
      } catch (err) {
        return json({ error: `Translation failed: ${err}` }, 502);
      }

      let translatedFm = fm;
      const titleMatch = fm.match(/^(title:\s*["']?)(.+?)(["']?\s*)$/m);
      if (titleMatch) {
        try {
          const translatedTitle = await mt.translate(titleMatch[2], defaultLang, targetLang);
          translatedFm = fm.replace(
            /^(title:\s*["']?)(.+?)(["']?\s*)$/m,
            (_: string, pre: string, _val: string, post: string) => pre + translatedTitle + post,
          );
        } catch (err) {
          return json({ error: `Title translation failed: ${err}` }, 502);
        }
      }

      const langPattern = supported.join("|");
      const existingLangRegex = new RegExp(`\\.(${langPattern})\\.(md|mdx|tsx)$`);
      let targetPath: string;
      if (existingLangRegex.test(sourcePath)) {
        targetPath = sourcePath.replace(existingLangRegex, `.${targetLang}.$2`);
      } else {
        targetPath = sourcePath.replace(/\.(md|mdx|tsx)$/, `.${targetLang}.$1`);
      }

      await storage.write(`${contentDir}/${targetPath}`, new TextEncoder().encode(translatedFm + translatedBody));
      engine.rebuild().catch((err: unknown) => console.error("[dune] MT translate-page rebuild error:", err));

      return json({ ok: true, targetPath });
    } catch (err) {
      return serverError(err);
    }
  },
};
