/**
 * Translation status — i18n dashboard showing per-language content status.
 *
 * Displays a grid of pages × languages with translation status indicators.
 */

import type { PageIndex } from "../../content/types.ts";

interface TranslationData {
  /** Configured languages */
  languages: string[];
  /** Default language */
  defaultLanguage: string;
  /** Pages with their translation status per language */
  pages: Array<{
    sourcePath: string;
    title: string;
    route: string;
    translations: Record<string, {
      exists: boolean;
      upToDate: boolean;
    }>;
  }>;
}

/**
 * Render the i18n translation status dashboard.
 */
export function renderTranslationStatus(prefix: string, data: TranslationData): string {
  if (data.languages.length === 0) {
    return `
    <div class="i18n-empty">
      <h3>Multilingual Not Configured</h3>
      <p>Add language configuration to your site config to enable translation tracking.</p>
      <pre><code>site:
  languages:
    supported: [en, fr, de, es]
    default: en</code></pre>
    </div>`;
  }

  const otherLangs = data.languages.filter((l) => l !== data.defaultLanguage);

  // Compute stats
  const totalPages = data.pages.length;
  const stats: Record<string, { translated: number; outdated: number; missing: number }> = {};
  for (const lang of otherLangs) {
    stats[lang] = { translated: 0, outdated: 0, missing: 0 };
    for (const page of data.pages) {
      const t = page.translations[lang];
      if (!t || !t.exists) {
        stats[lang].missing++;
      } else if (!t.upToDate) {
        stats[lang].outdated++;
      } else {
        stats[lang].translated++;
      }
    }
  }

  const langHeaders = otherLangs.map((l) => `<th class="i18n-lang-header">${l.toUpperCase()}</th>`).join("");
  const langStats = otherLangs.map((l) => {
    const s = stats[l];
    const pct = totalPages > 0 ? Math.round((s.translated / totalPages) * 100) : 0;
    return `
    <div class="i18n-lang-stat">
      <div class="lang-name">${l.toUpperCase()}</div>
      <div class="lang-bar">
        <div class="lang-bar-fill" style="width: ${pct}%"></div>
      </div>
      <div class="lang-numbers">
        <span class="stat-translated">${s.translated} translated</span>
        <span class="stat-outdated">${s.outdated} outdated</span>
        <span class="stat-missing">${s.missing} missing</span>
      </div>
    </div>`;
  }).join("");

  const tableRows = data.pages.map((page) => {
    const cells = otherLangs.map((lang) => {
      const t = page.translations[lang];
      if (!t || !t.exists) {
        return `<td class="i18n-cell cell-missing" title="Missing">⊘</td>`;
      } else if (!t.upToDate) {
        return `<td class="i18n-cell cell-outdated" title="Outdated">⟳</td>`;
      } else {
        return `<td class="i18n-cell cell-ok" title="Up to date">✓</td>`;
      }
    }).join("");

    return `
    <tr>
      <td class="i18n-page-cell">
        <a href="${prefix}/pages/edit?path=${encodeURIComponent(page.sourcePath)}" class="i18n-page-link">
          ${escapeHtml(page.title || page.sourcePath)}
        </a>
        <span class="i18n-route">${escapeHtml(page.route)}</span>
      </td>
      ${cells}
    </tr>`;
  }).join("");

  return `
  <div class="i18n-dashboard">
    <div class="i18n-overview">
      <h3>Translation Overview</h3>
      <div class="i18n-stats">
        ${langStats}
      </div>
    </div>

    <div class="i18n-table-wrapper">
      <table class="i18n-table">
        <thead>
          <tr>
            <th class="i18n-page-header">Page</th>
            ${langHeaders}
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <div class="i18n-legend">
      <span class="legend-item"><span class="cell-ok">✓</span> Translated &amp; up to date</span>
      <span class="legend-item"><span class="cell-outdated">⟳</span> Needs update</span>
      <span class="legend-item"><span class="cell-missing">⊘</span> Missing</span>
    </div>
  </div>
  `;
}

/**
 * CSS for translation status.
 */
export function translationStatusStyles(): string {
  return `
  .i18n-dashboard { }
  .i18n-empty { text-align: center; padding: 3rem; color: #6b7280; }
  .i18n-empty h3 { color: #374151; margin-bottom: 0.5rem; }
  .i18n-empty pre { display: inline-block; text-align: left; background: #f9fafb; border: 1px solid #e5e7eb; padding: 1rem; border-radius: 6px; margin-top: 1rem; }
  .i18n-overview { margin-bottom: 1.5rem; }
  .i18n-overview h3 { margin-bottom: 0.75rem; }
  .i18n-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
  .i18n-lang-stat { background: #fff; border-radius: 8px; padding: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .lang-name { font-weight: 700; font-size: 0.9rem; margin-bottom: 0.35rem; }
  .lang-bar { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin-bottom: 0.35rem; }
  .lang-bar-fill { height: 100%; background: #10b981; border-radius: 3px; transition: width 0.3s; }
  .lang-numbers { display: flex; gap: 0.5rem; font-size: 0.7rem; }
  .stat-translated { color: #10b981; }
  .stat-outdated { color: #f59e0b; }
  .stat-missing { color: #ef4444; }
  .i18n-table-wrapper { overflow-x: auto; }
  .i18n-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .i18n-table thead { background: #f9fafb; }
  .i18n-table th { padding: 0.5rem 0.75rem; text-align: left; font-size: 0.8rem; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; }
  .i18n-lang-header { text-align: center; min-width: 60px; }
  .i18n-table td { padding: 0.4rem 0.75rem; border-bottom: 1px solid #f3f4f6; }
  .i18n-page-cell { min-width: 200px; }
  .i18n-page-link { color: #1f2937; text-decoration: none; font-size: 0.85rem; font-weight: 500; }
  .i18n-page-link:hover { color: #c9a96e; }
  .i18n-route { display: block; font-size: 0.7rem; color: #9ca3af; font-family: monospace; }
  .i18n-cell { text-align: center; font-size: 0.9rem; }
  .cell-ok { color: #10b981; }
  .cell-outdated { color: #f59e0b; }
  .cell-missing { color: #d1d5db; }
  .i18n-legend { display: flex; gap: 1rem; margin-top: 0.75rem; font-size: 0.8rem; color: #6b7280; }
  .legend-item { display: flex; align-items: center; gap: 0.3rem; }
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
