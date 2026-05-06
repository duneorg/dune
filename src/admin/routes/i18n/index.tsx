/** @jsxImportSource preact */
/** GET /admin/i18n — translation status overview */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { engine, config } = getAdminContext();
    const supported = config.system.languages?.supported ?? [];
    const defaultLang = config.system.languages?.default ?? "en";

    const byLang = new Map<string, number>();
    for (const p of engine.pages) {
      const lang = p.language ?? defaultLang;
      byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
    }

    const langs = supported.length > 0 ? supported : Array.from(byLang.keys());
    const rows = langs.map((lang) => ({
      lang,
      count: byLang.get(lang) ?? 0,
      pct: engine.pages.length > 0 ? Math.round(((byLang.get(lang) ?? 0) / engine.pages.length) * 100) : 0,
    }));

    return ctx.render(<I18nRoute data={{ rows, defaultLang, total: engine.pages.length, prefix: getAdminContext().prefix }} />);
  },
};

export default function I18nRoute(
  { data }: { data: { rows: Array<{ lang: string; count: number; pct: number }>; defaultLang: string; total: number; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Translations</h2>
        <a href={`${data.prefix}/i18n/memory`} class="btn">Translation Memory</a>
      </div>
      <table class="admin-table">
        <thead><tr><th>Language</th><th>Pages</th><th>Coverage</th></tr></thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.lang}>
              <td>{row.lang}{row.lang === data.defaultLang ? " (default)" : ""}</td>
              <td>{row.count}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style={`height:8px;width:120px;background:#e2e8f0;border-radius:4px`}>
                    <div style={`height:8px;width:${row.pct}%;background:#4f46e5;border-radius:4px`} />
                  </div>
                  <span>{row.pct}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
