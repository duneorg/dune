/**
 * Translation Memory admin page.
 *
 * Shows TM entries for each language pair with options to:
 *  - Browse entries (source → target)
 *  - Delete individual entries
 *  - Add a new entry manually
 *  - Rebuild TM by scanning all existing translation pairs on disk
 */

export interface TMPageData {
  /** All configured languages */
  languages: string[];
  /** Default language code */
  defaultLanguage: string;
  /** Language pair shown currently */
  from: string;
  to: string;
  /** TM entries for the active pair, sorted by source */
  entries: Array<{ source: string; target: string }>;
}

/**
 * Render the Translation Memory admin page.
 */
export function renderTMPage(prefix: string, data: TMPageData): string {
  const otherLangs = data.languages.filter((l) => l !== data.defaultLanguage);

  // Language-pair tabs (default → each other lang)
  const tabs = otherLangs.map((lang) => {
    const active = lang === data.to;
    return `<a href="${prefix}/i18n/memory?from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(lang)}"
              class="tm-tab${active ? " tm-tab-active" : ""}">${data.from.toUpperCase()} → ${lang.toUpperCase()}</a>`;
  }).join("");

  const entryRows = data.entries.length === 0
    ? `<tr><td colspan="3" class="tm-empty-cell">No entries yet — click <strong>Rebuild from Translations</strong> to scan existing pages.</td></tr>`
    : data.entries.map((e) => `
    <tr class="tm-row">
      <td class="tm-source"><pre>${escapeHtml(e.source)}</pre></td>
      <td class="tm-target"><pre>${escapeHtml(e.target)}</pre></td>
      <td class="tm-actions">
        <button class="btn btn-xs btn-danger" onclick="deleteEntry(${JSON.stringify(e.source)})">Delete</button>
      </td>
    </tr>`).join("");

  return `
  <div class="tm-header">
    <div class="tm-tabs">${tabs || '<span class="tm-no-langs">No additional languages configured.</span>'}</div>
    <div class="tm-toolbar">
      <span class="tm-count">${data.entries.length} ${data.entries.length === 1 ? "entry" : "entries"}</span>
      <button class="btn btn-sm btn-outline" onclick="showAddForm()">+ Add Entry</button>
      <button class="btn btn-sm btn-outline" id="rebuild-btn" onclick="rebuildTM()">Rebuild from Translations</button>
    </div>
  </div>

  <!-- Add entry form (hidden by default) -->
  <div id="add-form" class="tm-add-form" style="display:none">
    <h4>Add / Update Entry</h4>
    <div class="tm-add-row">
      <div class="form-group">
        <label>${escapeHtml(data.from.toUpperCase())} (source)</label>
        <textarea id="add-source" rows="3" placeholder="Source text…"></textarea>
      </div>
      <div class="form-group">
        <label>${escapeHtml(data.to.toUpperCase())} (translation)</label>
        <textarea id="add-target" rows="3" placeholder="Translated text…"></textarea>
      </div>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
      <button class="btn btn-sm btn-primary" onclick="addEntry()">Save Entry</button>
      <button class="btn btn-sm btn-outline" onclick="hideAddForm()">Cancel</button>
    </div>
  </div>

  <div class="tm-table-wrap">
    <table class="tm-table">
      <thead>
        <tr>
          <th>${escapeHtml(data.from.toUpperCase())} (source)</th>
          <th>${escapeHtml(data.to.toUpperCase())} (translation)</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody id="tm-tbody">
        ${entryRows}
      </tbody>
    </table>
  </div>

  <script>${tmPageScript(prefix, data.from, data.to)}</script>
  `;
}

function tmPageScript(prefix: string, from: string, to: string): string {
  return `
    function showAddForm() {
      document.getElementById('add-form').style.display = 'block';
      document.getElementById('add-source').focus();
    }
    function hideAddForm() {
      document.getElementById('add-form').style.display = 'none';
      document.getElementById('add-source').value = '';
      document.getElementById('add-target').value = '';
    }

    function addEntry() {
      const source = document.getElementById('add-source').value.trim();
      const target = document.getElementById('add-target').value.trim();
      if (!source || !target) { alert('Both source and target are required.'); return; }
      fetch('${prefix}/api/i18n/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, source, target }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { location.reload(); }
        else { alert('Error: ' + (res.error || 'Unknown')); }
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function deleteEntry(source) {
      if (!confirm('Delete this TM entry?')) return;
      fetch('${prefix}/api/i18n/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, source }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { location.reload(); }
        else { alert('Error: ' + (res.error || 'Unknown')); }
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function rebuildTM() {
      const btn = document.getElementById('rebuild-btn');
      btn.disabled = true;
      btn.textContent = 'Rebuilding…';
      fetch('${prefix}/api/i18n/memory/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)} }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) {
          btn.textContent = 'Added ' + res.added + ' entries!';
          setTimeout(() => location.reload(), 800);
        } else {
          alert('Error: ' + (res.error || 'Unknown'));
          btn.disabled = false;
          btn.textContent = 'Rebuild from Translations';
        }
      })
      .catch(err => {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Rebuild from Translations';
      });
    }
  `;
}

/**
 * CSS for the Translation Memory page.
 */
export function tmPageStyles(): string {
  return `
  .tm-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  .tm-tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .tm-tab { display: inline-block; padding: 0.3rem 0.75rem; border-radius: 4px 4px 0 0; border: 1px solid #e5e7eb; border-bottom: none; background: #f9fafb; color: #374151; text-decoration: none; font-size: 0.82rem; font-weight: 500; transition: background 0.15s; }
  .tm-tab:hover { background: #f3f4f6; }
  .tm-tab-active { background: #fff; color: #1a6fa8; border-color: #d1d5db; }
  .tm-no-langs { font-size: 0.85rem; color: #6b7280; }
  .tm-toolbar { display: flex; align-items: center; gap: 0.5rem; }
  .tm-count { font-size: 0.8rem; color: #6b7280; }
  .tm-add-form { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  .tm-add-form h4 { margin: 0 0 0.75rem; font-size: 0.9rem; }
  .tm-add-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .tm-add-row textarea { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 0.82rem; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.4rem; resize: vertical; }
  .tm-table-wrap { overflow-x: auto; }
  .tm-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.82rem; }
  .tm-table thead { background: #f9fafb; }
  .tm-table th { padding: 0.5rem 0.75rem; text-align: left; font-size: 0.8rem; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; }
  .tm-row { border-bottom: 1px solid #f3f4f6; }
  .tm-row:hover { background: #fafafa; }
  .tm-source, .tm-target { padding: 0.4rem 0.75rem; vertical-align: top; width: 45%; }
  .tm-source pre, .tm-target pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 0.8rem; line-height: 1.5; color: #374151; }
  .tm-actions { padding: 0.4rem 0.75rem; text-align: center; vertical-align: middle; }
  .tm-empty-cell { padding: 2rem; text-align: center; color: #6b7280; }
  .btn-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .btn-danger:hover { background: #fca5a5; }
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
