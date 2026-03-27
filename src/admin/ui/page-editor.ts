/**
 * Page editor UI — two-panel editor with block editing and live preview.
 *
 * Left panel: Block editor (visual) or raw source editor
 * Right panel: Live preview iframe
 * Sidebar: Frontmatter editor (title, slug, template, taxonomy, etc.)
 */

// Minimal inline types to avoid importing blueprint types into the UI module
interface BpField {
  type: string;
  label: string;
  default?: unknown;
  required?: boolean;
  options?: Record<string, string>;
}
interface ResolvedBp {
  title: string;
  fields: Record<string, BpField>;
}

/**
 * Render the page editor page.
 */
export function renderPageEditorPage(
  prefix: string,
  userName: string,
  pageData: {
    sourcePath: string;
    route: string;
    title: string;
    format: string;
    template: string;
    published: boolean;
    rawContent: string | null;
    frontmatter: Record<string, unknown>;
    media: Array<{ name: string; url: string; type: string; size: number }>;
    taxonomies: string[];
    taxonomyValues: Record<string, string[]>;
    blueprint: ResolvedBp | null;
    revisionCount?: number;
    /** Current page language code (e.g. "de"). Undefined on monolingual sites. */
    language?: string;
    /** Default site language (e.g. "en"). Undefined on monolingual sites. */
    defaultLanguage?: string;
    /** All sibling language versions with their existence status. */
    translations?: Array<{ lang: string; sourcePath: string; exists: boolean }>;
    /** Raw content of the default-language sibling, shown as a reference panel. */
    referenceContent?: string | null;
    /** Translation Memory suggestions — source/target pairs matched from reference segments. */
    tmSuggestions?: Array<{ source: string; target: string }>;
  },
): string {
  const fm = pageData.frontmatter;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Edit: ${escapeHtml(pageData.title)} — Dune Admin</title>
  <style>${editorStyles()}</style>
</head>
<body>
  <div class="editor-layout">
    <!-- Top toolbar -->
    <header class="editor-toolbar">
      <div class="toolbar-left">
        <a href="${prefix}/pages" class="btn btn-sm btn-outline">← Pages</a>
        <span class="editor-title">${escapeHtml(pageData.title)}</span>
        <span class="badge badge-${pageData.format}">${pageData.format}</span>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-sm btn-outline" onclick="togglePreview()">Preview</button>
        <button class="btn btn-sm btn-outline" onclick="toggleSource()">Source</button>
        <a href="${escapeAttr(pageData.route)}" target="_blank" class="btn btn-sm btn-outline">View →</a>
        <a href="${prefix}/pages/history?path=${encodeURIComponent(pageData.sourcePath)}" class="btn btn-sm btn-outline">History${pageData.revisionCount ? ` <span class="toolbar-rev-count">${pageData.revisionCount}</span>` : ""}</a>
        ${pageData.referenceContent != null ? `<button class="btn btn-sm btn-outline" id="ref-toggle" onclick="toggleReference()">Reference: ${escapeHtml(pageData.defaultLanguage ?? "")}</button>` : ""}
        <button class="btn btn-sm btn-primary" onclick="savePage()">Save</button>
      </div>
    </header>

    <div class="editor-body">
      <!-- Frontmatter sidebar -->
      <aside class="editor-sidebar" id="editor-sidebar">
        <h4>Page Settings</h4>
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="fm-title" value="${escapeAttr(String(fm.title ?? ""))}" onchange="markDirty()">
        </div>
        <div class="form-group">
          <label>Template</label>
          <input type="text" id="fm-template" value="${escapeAttr(String(fm.template ?? "default"))}" onchange="markDirty()">
        </div>
        <div class="form-group">
          <label>Slug</label>
          <input type="text" id="fm-slug" value="${escapeAttr(String(fm.slug ?? ""))}" placeholder="auto" onchange="markDirty()">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="fm-published" ${fm.published !== false ? "checked" : ""} onchange="markDirty()">
            Published
          </label>
        </div>
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="fm-date" value="${escapeAttr(String(fm.date ?? ""))}" onchange="markDirty()">
        </div>

        ${pageData.taxonomies.length > 0 ? `
        <h4>Taxonomy</h4>
        ${pageData.taxonomies.map((taxName) => {
          const suggVals = pageData.taxonomyValues[taxName] ?? [];
          return `<div class="form-group">
          <label>${escapeHtml(taxName.charAt(0).toUpperCase() + taxName.slice(1))}</label>
          <div class="tag-input-wrapper" id="tax-${escapeAttr(taxName)}-wrapper">
            <div class="tag-chips" id="tax-${escapeAttr(taxName)}-chips"></div>
            <input type="text" class="tag-input" id="tax-${escapeAttr(taxName)}-input"
                   placeholder="Add ${escapeAttr(taxName)}…"
                   list="tax-${escapeAttr(taxName)}-list"
                   autocomplete="off"
                   onkeydown="handleTagKey(event,'${escapeAttr(taxName)}')">
            <datalist id="tax-${escapeAttr(taxName)}-list">
              ${suggVals.map((v) => `<option value="${escapeAttr(v)}">`).join("")}
            </datalist>
          </div>
        </div>`;
        }).join("")}
        ` : ""}

        ${pageData.blueprint && Object.keys(pageData.blueprint.fields).length > 0 ? `
        <h4>${escapeHtml(pageData.blueprint.title)}</h4>
        ${Object.entries(pageData.blueprint.fields).map(([fieldName, field]) => {
          const currentVal = pageData.frontmatter[fieldName];
          const id = `bp-${escapeAttr(fieldName)}`;
          const label = `${escapeHtml(field.label)}${field.required ? " <span class=\"required-mark\">*</span>" : ""}`;

          let input = "";
          if (field.type === "toggle") {
            const checked = currentVal === true || (currentVal === undefined && field.default === true) ? "checked" : "";
            input = `<label class="toggle-label"><input type="checkbox" id="${id}" ${checked} onchange="markDirty()"> ${escapeHtml(field.label)}</label>`;
            return `<div class="form-group">${input}</div>`;
          }
          if (field.type === "select" && field.options) {
            const opts = Object.entries(field.options).map(([val, lbl]) =>
              `<option value="${escapeAttr(val)}"${currentVal === val ? " selected" : ""}>${escapeHtml(lbl)}</option>`
            ).join("");
            input = `<select id="${id}" onchange="markDirty()"><option value=""></option>${opts}</select>`;
          } else if (field.type === "textarea" || field.type === "markdown") {
            const val = typeof currentVal === "string" ? currentVal : (typeof field.default === "string" ? field.default : "");
            input = `<textarea id="${id}" class="bp-textarea" rows="4" onchange="markDirty()">${escapeHtml(val)}</textarea>`;
          } else if (field.type === "number") {
            const val = typeof currentVal === "number" ? currentVal : (typeof field.default === "number" ? field.default : "");
            input = `<input type="number" id="${id}" value="${escapeAttr(String(val))}" onchange="markDirty()">`;
          } else if (field.type === "date") {
            const val = typeof currentVal === "string" ? currentVal : (typeof field.default === "string" ? field.default : "");
            input = `<input type="date" id="${id}" value="${escapeAttr(val)}" onchange="markDirty()">`;
          } else if (field.type === "color") {
            const val = typeof currentVal === "string" ? currentVal : (typeof field.default === "string" ? field.default : "#000000");
            input = `<div class="color-row"><input type="color" id="${id}-picker" value="${escapeAttr(val)}" oninput="syncColor('${escapeAttr(fieldName)}')"><input type="text" id="${id}" value="${escapeAttr(val)}" class="color-text" oninput="syncColorText('${escapeAttr(fieldName)}')" onchange="markDirty()"></div>`;
          } else if (field.type === "list") {
            const items: string[] = Array.isArray(currentVal)
              ? (currentVal as unknown[]).map(String)
              : (Array.isArray(field.default) ? (field.default as unknown[]).map(String) : []);
            input = `<div class="tag-input-wrapper" id="${id}-wrapper">
              <div class="tag-chips" id="${id}-chips"></div>
              <input type="text" class="tag-input" id="${id}-input"
                     placeholder="Add item…" autocomplete="off"
                     onkeydown="handleBpListKey(event,'${escapeAttr(fieldName)}')">
            </div>`;
            // Embed initial items as a data attribute for JS to pick up
            return `<div class="form-group" data-bp-list="${escapeAttr(fieldName)}" data-bp-items='${JSON.stringify(items).replace(/'/g, "&#39;")}'>
              <label>${label}</label>${input}</div>`;
          } else {
            // text / file / fallback
            const val = typeof currentVal === "string" ? currentVal : (typeof field.default === "string" ? field.default : "");
            input = `<input type="text" id="${id}" value="${escapeAttr(val)}" onchange="markDirty()">`;
          }
          return `<div class="form-group"><label>${label}</label>${input}</div>`;
        }).join("")}
        ` : ""}

        <div class="media-section-header">
          <h4 style="margin:0">Media Files</h4>
          <label class="btn btn-xs btn-outline" style="cursor:pointer" title="Upload a file to this page's folder">
            Upload
            <input type="file" id="page-media-upload" style="display:none" accept="image/*,video/*,audio/*,.pdf,.zip,.csv,.json" onchange="uploadPageMedia(event)">
          </label>
        </div>
        <div class="media-list" id="page-media-list">
          ${pageData.media.length === 0 ? `<p class="media-empty-hint">No media files yet.</p>` : pageData.media.map((m) => `
            <div class="media-item">
              ${m.type.startsWith("image/") ? `<img src="${escapeAttr(m.url)}" alt="${escapeAttr(m.name)}" class="media-thumb">` : `<span class="media-file-icon">📎</span>`}
              <span class="media-name" title="${escapeAttr(m.name)}">${escapeHtml(m.name)}</span>
              <button class="btn btn-xs" onclick="insertMedia('${escapeAttr(m.name)}', '${escapeAttr(m.url)}')" title="Insert into editor">+</button>
            </div>
          `).join("")}
        </div>

        <div class="sidebar-section">
          <h4>Info</h4>
          <div class="info-row"><span>Source:</span> <code>${escapeHtml(pageData.sourcePath)}</code></div>
          <div class="info-row"><span>Route:</span> <code>${escapeHtml(pageData.route)}</code></div>
          <div class="info-row"><span>Format:</span> ${pageData.format}</div>
        </div>

        ${(pageData.translations?.length ?? 0) > 0 ? `
        <div class="sidebar-section">
          <h4>Translations</h4>
          ${pageData.translations!.map((t) => {
            const isCurrent = t.lang === pageData.language;
            const langBadge = `<span class="badge-lang${isCurrent ? " badge-lang-current" : t.exists ? "" : " badge-lang-missing"}">${escapeHtml(t.lang)}</span>`;
            if (isCurrent) {
              return `<div class="translation-row">${langBadge} <em class="translation-editing">editing</em></div>`;
            }
            if (t.exists) {
              return `<div class="translation-row">${langBadge} <a href="${prefix}/pages/edit?path=${encodeURIComponent(t.sourcePath)}" class="btn btn-xs">Edit</a></div>`;
            }
            return `<div class="translation-row">${langBadge} <button class="btn btn-xs btn-outline" onclick="createTranslation('${escapeAttr(pageData.sourcePath)}','${escapeAttr(t.lang)}')">Create</button></div>`;
          }).join("")}
        </div>` : ""}

        ${(pageData.tmSuggestions?.length ?? 0) > 0 ? `
        <div class="sidebar-section tm-suggestions-section">
          <h4>TM Suggestions <span class="tm-badge">${pageData.tmSuggestions!.length}</span></h4>
          <p class="tm-hint">Matched segments from the translation memory. Click to copy the translation.</p>
          <div class="tm-suggestion-list">
            ${pageData.tmSuggestions!.map((s) => `
            <div class="tm-suggestion">
              <div class="tm-suggestion-source">${escapeHtml(s.source.length > 120 ? s.source.slice(0, 120) + "…" : s.source)}</div>
              <div class="tm-suggestion-target">${escapeHtml(s.target.length > 120 ? s.target.slice(0, 120) + "…" : s.target)}</div>
              <button class="btn btn-xs tm-copy-btn" onclick="copyTMSuggestion(${JSON.stringify(s.target)})" title="Copy translation to clipboard">Copy</button>
            </div>`).join("")}
          </div>
        </div>` : ""}
      </aside>

      ${pageData.referenceContent != null ? `
      <!-- Reference panel — shows default-language source for translators -->
      <div class="editor-reference" id="editor-reference" style="display:none">
        <div class="editor-reference-header">
          <span>Reference: ${escapeHtml(pageData.defaultLanguage ?? "")}</span>
          <button onclick="toggleReference()" class="btn btn-xs" title="Close reference panel">✕</button>
        </div>
        <pre class="editor-reference-content">${escapeHtml(pageData.referenceContent)}</pre>
      </div>` : ""}

      <!-- Main editor area -->
      <div class="editor-main">
        <!-- Block editor view -->
        <div class="editor-view" id="block-editor">
          <div class="block-list" id="block-list">
            <!-- Blocks populated by JS -->
          </div>
          <button class="btn btn-sm btn-outline add-block-btn" onclick="addBlock('paragraph')">+ Add Block</button>
        </div>

        <!-- Source editor view (hidden by default) -->
        <div class="editor-view" id="source-editor" style="display:none">
          <textarea id="source-textarea" class="source-textarea" spellcheck="false" onchange="markDirty()">${escapeHtml(pageData.rawContent ?? "")}</textarea>
        </div>
      </div>

      <!-- Preview panel (hidden by default) -->
      <div class="editor-preview" id="preview-panel" style="display:none">
        <iframe id="preview-frame" src="about:blank"></iframe>
      </div>
    </div>
  </div>

  <script>
  ${editorScript(prefix, pageData)}
  </script>
</body>
</html>`;
}

function editorScript(
  prefix: string,
  pageData: {
    sourcePath: string;
    rawContent: string | null;
    format: string;
    frontmatter: Record<string, unknown>;
    taxonomies: string[];
    blueprint: ResolvedBp | null;
  },
): string {
  // Pre-compute initial taxonomy state server-side for embedding
  const taxFm = (pageData.frontmatter.taxonomy as Record<string, string[]> | undefined) ?? {};
  const initTaxState = Object.fromEntries(
    pageData.taxonomies.map((name) => [name, taxFm[name] ?? []]),
  );

  // Blueprint: build field metadata and list-field initial state for client JS
  const bpFields: Record<string, string> = {}; // fieldName → type
  const bpRequiredFields: string[] = []; // fieldNames that are required (for client-side validation)
  const bpListState: Record<string, string[]> = {}; // fieldName → items (list fields only)
  if (pageData.blueprint) {
    for (const [name, field] of Object.entries(pageData.blueprint.fields)) {
      bpFields[name] = field.type;
      if (field.required) bpRequiredFields.push(name);
      if (field.type === "list") {
        const cur = pageData.frontmatter[name];
        bpListState[name] = Array.isArray(cur)
          ? (cur as unknown[]).map(String)
          : (Array.isArray(field.default) ? (field.default as unknown[]).map(String) : []);
      }
    }
  }

  return `
    // Editor state
    let blocks = [];
    let isDirty = false;
    let sourceMode = false;
    let previewVisible = false;

    // --- Taxonomy state ---
    const taxonomyState = ${JSON.stringify(initTaxState)};
    const configuredTaxonomies = ${JSON.stringify(pageData.taxonomies)};

    function initTaxonomy() {
      for (const taxName of configuredTaxonomies) {
        renderTagChips(taxName);
      }
    }

    function renderTagChips(taxName) {
      const chips = document.getElementById('tax-' + taxName + '-chips');
      if (!chips) return;
      chips.innerHTML = (taxonomyState[taxName] || []).map(val =>
        '<span class="tag-chip">' + escapeHtml(String(val)) +
        ' <button class="tag-chip-remove" data-tax="' + escapeAttr(taxName) +
        '" data-val="' + escapeAttr(String(val)) +
        '" onclick="removeTag(this.dataset.tax,this.dataset.val)" title="Remove">×</button>' +
        '</span>'
      ).join('');
    }

    function addTag(taxName, value) {
      value = value.trim();
      if (!value) return;
      if (!taxonomyState[taxName]) taxonomyState[taxName] = [];
      if (!taxonomyState[taxName].includes(value)) {
        taxonomyState[taxName].push(value);
        renderTagChips(taxName);
        markDirty();
      }
      const input = document.getElementById('tax-' + taxName + '-input');
      if (input) input.value = '';
    }

    function removeTag(taxName, value) {
      if (!taxonomyState[taxName]) return;
      const idx = taxonomyState[taxName].indexOf(value);
      if (idx !== -1) {
        taxonomyState[taxName].splice(idx, 1);
        renderTagChips(taxName);
        markDirty();
      }
    }

    function handleTagKey(event, taxName) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTag(taxName, event.target.value.replace(/,\\s*$/, ''));
      }
    }

    // --- Blueprint custom fields ---
    const bpFields = ${JSON.stringify(bpFields)};
    const bpRequiredFields = ${JSON.stringify(bpRequiredFields)};
    const bpListState = ${JSON.stringify(bpListState)};

    // Clear all blueprint field error highlights
    function clearBpErrors() {
      document.querySelectorAll('.form-group.bp-field-error').forEach(function(fg) {
        fg.classList.remove('bp-field-error');
        const msg = fg.querySelector('.bp-field-error-msg');
        if (msg) msg.remove();
      });
    }

    // Highlight a single field as invalid, return the form-group element
    function markBpFieldError(fieldName, message) {
      const el = document.getElementById('bp-' + fieldName) ||
                 document.getElementById('bp-' + fieldName + '-input') ||
                 document.querySelector('[data-bp-list="' + fieldName + '"]');
      const fg = el && el.closest('.form-group');
      if (fg && !fg.classList.contains('bp-field-error')) {
        fg.classList.add('bp-field-error');
        const msg = document.createElement('p');
        msg.className = 'bp-field-error-msg';
        msg.textContent = message || 'This field is required';
        fg.appendChild(msg);
      }
      return fg;
    }

    // Client-side required-field check before save; returns true if valid
    function validateBpRequired() {
      if (bpRequiredFields.length === 0) return true;
      clearBpErrors();
      const missing = [];
      bpRequiredFields.forEach(function(name) {
        const type = bpFields[name];
        if (type === 'toggle') return; // checkboxes always have a boolean value
        if (type === 'list') {
          if ((bpListState[name] || []).length === 0) missing.push(name);
        } else if (type === 'number') {
          const el = document.getElementById('bp-' + name);
          if (!el || el.value === '') missing.push(name);
        } else {
          const el = document.getElementById('bp-' + name);
          if (!el || !el.value.trim()) missing.push(name);
        }
      });
      if (missing.length === 0) return true;
      let firstFg = null;
      missing.forEach(function(name) {
        const fg = markBpFieldError(name, 'This field is required');
        if (!firstFg && fg) firstFg = fg;
      });
      if (firstFg) firstFg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }

    // Show server-returned validation errors inline
    function showBpValidationErrors(errors) {
      clearBpErrors();
      let firstFg = null;
      (errors || []).forEach(function(err) {
        const fg = markBpFieldError(err.field, err.message);
        if (!firstFg && fg) firstFg = fg;
      });
      if (firstFg) firstFg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function initBlueprintFields() {
      // Restore list-field chips from server-rendered data attributes
      document.querySelectorAll('[data-bp-list]').forEach(function(el) {
        const fieldName = el.dataset.bpList;
        try {
          const items = JSON.parse(el.dataset.bpItems || '[]');
          bpListState[fieldName] = items;
        } catch(e) {}
        renderBpListChips(fieldName);
      });
      // Auto-clear validation errors when user edits a blueprint field
      document.querySelectorAll('[id^="bp-"]').forEach(function(el) {
        ['input', 'change'].forEach(function(evType) {
          el.addEventListener(evType, function() {
            const fg = el.closest('.form-group');
            if (fg && fg.classList.contains('bp-field-error')) {
              fg.classList.remove('bp-field-error');
              const msg = fg.querySelector('.bp-field-error-msg');
              if (msg) msg.remove();
            }
          });
        });
      });
      // Color fields — keep picker and text in sync on load
      Object.keys(bpFields).forEach(function(fieldName) {
        if (bpFields[fieldName] === 'color') {
          const picker = document.getElementById('bp-' + fieldName + '-picker');
          const text = document.getElementById('bp-' + fieldName);
          if (picker && text) picker.value = text.value || '#000000';
        }
      });
    }

    function renderBpListChips(fieldName) {
      const id = 'bp-' + fieldName;
      const chips = document.getElementById(id + '-chips');
      if (!chips) return;
      chips.innerHTML = (bpListState[fieldName] || []).map(function(val) {
        return '<span class="tag-chip">' + escapeHtml(String(val)) +
          ' <button class="tag-chip-remove" data-bplist="' + escapeAttr(fieldName) +
          '" data-val="' + escapeAttr(String(val)) +
          '" onclick="removeBpListItem(this.dataset.bplist,this.dataset.val)" title="Remove">×</button>' +
          '</span>';
      }).join('');
    }

    function addBpListItem(fieldName, value) {
      value = value.trim();
      if (!value) return;
      if (!bpListState[fieldName]) bpListState[fieldName] = [];
      if (!bpListState[fieldName].includes(value)) {
        bpListState[fieldName].push(value);
        renderBpListChips(fieldName);
        markDirty();
      }
      const input = document.getElementById('bp-' + fieldName + '-input');
      if (input) input.value = '';
    }

    function removeBpListItem(fieldName, value) {
      if (!bpListState[fieldName]) return;
      const idx = bpListState[fieldName].indexOf(value);
      if (idx !== -1) {
        bpListState[fieldName].splice(idx, 1);
        renderBpListChips(fieldName);
        markDirty();
      }
    }

    function handleBpListKey(event, fieldName) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addBpListItem(fieldName, event.target.value.replace(/,\\s*$/, ''));
      }
    }

    function syncColor(fieldName) {
      const picker = document.getElementById('bp-' + fieldName + '-picker');
      const text = document.getElementById('bp-' + fieldName);
      if (picker && text) { text.value = picker.value; markDirty(); }
    }

    function syncColorText(fieldName) {
      const picker = document.getElementById('bp-' + fieldName + '-picker');
      const text = document.getElementById('bp-' + fieldName);
      if (picker && text && /^#[0-9a-f]{6}$/i.test(text.value)) {
        picker.value = text.value;
      }
      markDirty();
    }

    // Block type definitions for the add menu
    const BLOCK_TYPES = [
      { type: 'paragraph', label: 'Paragraph', icon: '¶' },
      { type: 'heading', label: 'Heading', icon: 'H' },
      { type: 'list', label: 'List', icon: '•' },
      { type: 'blockquote', label: 'Quote', icon: '"' },
      { type: 'code', label: 'Code', icon: '<>' },
      { type: 'image', label: 'Image', icon: '🖼' },
      { type: 'divider', label: 'Divider', icon: '—' },
      { type: 'table', label: 'Table', icon: '⊞' },
    ];

    // Initialize blocks from source content
    function initEditor() {
      const content = ${JSON.stringify(pageData.rawContent ?? "")};
      if (content && ${JSON.stringify(pageData.format !== "tsx")}) {
        // Parse markdown to blocks via API
        fetch('${prefix}/api/editor/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        .then(r => r.json())
        .then(data => {
          blocks = data.blocks || [];
          renderBlocks();
        })
        .catch(() => {
          // Fallback: single paragraph block
          blocks = [{ id: genId(), type: 'paragraph', text: content }];
          renderBlocks();
        });
      } else {
        blocks = [];
        renderBlocks();
      }
    }

    function genId() {
      return Math.random().toString(36).substr(2, 8);
    }

    function markDirty() {
      isDirty = true;
      document.querySelector('.editor-title').style.fontStyle = 'italic';
    }

    // Render all blocks
    function renderBlocks() {
      const list = document.getElementById('block-list');
      list.innerHTML = blocks.map((block, i) => renderBlock(block, i)).join('');
    }

    function renderBlock(block, index) {
      const moveUp = index > 0 ? '<button class="block-action" onclick="moveBlock(' + index + ',-1)" title="Move up">↑</button>' : '';
      const moveDown = index < blocks.length - 1 ? '<button class="block-action" onclick="moveBlock(' + index + ',1)" title="Move down">↓</button>' : '';

      let content = '';
      switch (block.type) {
        case 'paragraph':
          content = '<div class="block-input" contenteditable="true" data-index="' + index + '" data-field="text" onblur="updateField(this)">' + escapeHtml(block.text || '') + '</div>';
          break;
        case 'heading':
          content = '<div class="block-heading-row"><select class="block-level" onchange="updateLevel(' + index + ', this.value)">' +
            [1,2,3,4,5,6].map(l => '<option value="' + l + '"' + (block.level === l ? ' selected' : '') + '>H' + l + '</option>').join('') +
            '</select><div class="block-input block-heading" contenteditable="true" data-index="' + index + '" data-field="text" onblur="updateField(this)">' + escapeHtml(block.text || '') + '</div></div>';
          break;
        case 'list':
          content = '<div class="block-list-editor"><label><input type="checkbox" ' + (block.ordered ? 'checked' : '') + ' onchange="toggleOrdered(' + index + ', this.checked)"> Ordered</label>' +
            '<div class="block-list-items">' + (block.items || []).map((item, j) =>
              '<div class="list-item-row"><span class="list-bullet">' + (block.ordered ? (j+1)+'.' : '•') + '</span><div contenteditable="true" class="block-input list-item-input" data-index="' + index + '" data-item="' + j + '" onblur="updateListItem(this)">' + escapeHtml(item) + '</div><button class="block-action" onclick="removeListItem(' + index + ',' + j + ')">×</button></div>'
            ).join('') + '</div>' +
            '<button class="btn btn-xs btn-outline" onclick="addListItem(' + index + ')">+ Item</button></div>';
          break;
        case 'blockquote':
          content = '<div class="block-quote-bar"><div class="block-input" contenteditable="true" data-index="' + index + '" data-field="text" onblur="updateField(this)">' + escapeHtml(block.text || '') + '</div></div>';
          break;
        case 'code':
          content = '<div class="block-code-editor"><input type="text" class="code-lang" placeholder="language" value="' + (block.language || '') + '" onchange="updateCodeLang(' + index + ', this.value)"><textarea class="code-textarea" data-index="' + index + '" onchange="updateCode(' + index + ', this.value)">' + escapeHtml(block.code || '') + '</textarea></div>';
          break;
        case 'image':
          content = '<div class="block-image-editor"><input type="text" placeholder="Image source" value="' + escapeAttr(block.src || '') + '" onchange="updateImgField(' + index + ', \\'src\\', this.value)"><input type="text" placeholder="Alt text" value="' + escapeAttr(block.alt || '') + '" onchange="updateImgField(' + index + ', \\'alt\\', this.value)">' +
            (block.src ? '<img src="' + escapeAttr(block.src) + '" class="block-image-preview">' : '') + '</div>';
          break;
        case 'divider':
          content = '<hr class="block-divider">';
          break;
        case 'table':
          content = '<div class="block-table-editor"><table class="block-table"><thead><tr>' +
            (block.headers || []).map((h, j) => '<th><div contenteditable="true" data-index="' + index + '" data-header="' + j + '" onblur="updateTableHeader(this)">' + escapeHtml(h) + '</div></th>').join('') +
            '</tr></thead><tbody>' +
            (block.rows || []).map((row, ri) => '<tr>' + row.map((cell, ci) => '<td><div contenteditable="true" data-index="' + index + '" data-row="' + ri + '" data-col="' + ci + '" onblur="updateTableCell(this)">' + escapeHtml(cell) + '</div></td>').join('') + '</tr>').join('') +
            '</tbody></table></div>';
          break;
        case 'html':
          content = '<textarea class="html-textarea" data-index="' + index + '" onchange="updateHtml(' + index + ', this.value)">' + escapeHtml(block.html || '') + '</textarea>';
          break;
        default:
          content = '<div class="block-unknown">Unknown block: ' + block.type + '</div>';
      }

      return '<div class="block" data-index="' + index + '" data-type="' + block.type + '"' +
        ' draggable="true"' +
        ' ondragstart="handleBlockDragStart(event,' + index + ')"' +
        ' ondragover="handleBlockDragOver(event,' + index + ')"' +
        ' ondragleave="handleBlockDragLeave(event)"' +
        ' ondrop="handleBlockDrop(event,' + index + ')"' +
        ' ondragend="handleBlockDragEnd()">' +
        '<div class="block-header">' +
        '<span class="block-drag-handle" title="Drag to reorder">⠿</span>' +
        '<span class="block-type-label">' + block.type + '</span>' +
        '<div class="block-controls">' + moveUp + moveDown +
        '<button class="block-action block-action-delete" onclick="removeBlock(' + index + ')" title="Delete">🗑</button></div></div>' +
        '<div class="block-content">' + content + '</div>' +
        '<div class="block-add-below"><button class="btn btn-xs btn-outline" onclick="showAddMenu(' + index + ')">+</button></div></div>';
    }

    // Block operations
    function addBlock(type, afterIndex) {
      const idx = afterIndex !== undefined ? afterIndex + 1 : blocks.length;
      const block = createDefaultBlock(type);
      blocks.splice(idx, 0, block);
      renderBlocks();
      markDirty();
    }

    function createDefaultBlock(type) {
      const id = genId();
      switch (type) {
        case 'paragraph': return { id, type, text: '' };
        case 'heading': return { id, type, level: 2, text: '' };
        case 'list': return { id, type, ordered: false, items: [''] };
        case 'blockquote': return { id, type, text: '' };
        case 'code': return { id, type, language: '', code: '' };
        case 'image': return { id, type, src: '', alt: '' };
        case 'divider': return { id, type: 'divider' };
        case 'table': return { id, type, headers: ['Col 1', 'Col 2'], rows: [['', '']] };
        case 'html': return { id, type, html: '' };
        default: return { id, type: 'paragraph', text: '' };
      }
    }

    function removeBlock(index) {
      blocks.splice(index, 1);
      renderBlocks();
      markDirty();
    }

    function moveBlock(index, dir) {
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= blocks.length) return;
      [blocks[index], blocks[newIndex]] = [blocks[newIndex], blocks[index]];
      renderBlocks();
      markDirty();
    }

    // ── Block drag-and-drop ──────────────────────────────────────────────────
    let blockDragSrcIndex = null;

    function clearBlockDragState() {
      blockDragSrcIndex = null;
      document.querySelectorAll('.block').forEach(b => b.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
    }

    function handleBlockDragStart(e, index) {
      // Only start drag if user grabbed the drag handle
      if (!e.target.classList.contains('block-drag-handle')) {
        e.preventDefault();
        return;
      }
      blockDragSrcIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => {
        const els = document.querySelectorAll('.block');
        if (els[index]) els[index].classList.add('dragging');
      }, 0);
    }

    function handleBlockDragOver(e, index) {
      if (blockDragSrcIndex === null || blockDragSrcIndex === index) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      document.querySelectorAll('.block').forEach(b => b.classList.remove('drag-over-top', 'drag-over-bottom'));
      e.currentTarget.classList.add(isAbove ? 'drag-over-top' : 'drag-over-bottom');
    }

    function handleBlockDragLeave(e) {
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
    }

    function handleBlockDrop(e, targetIndex) {
      e.preventDefault();
      if (blockDragSrcIndex === null || blockDragSrcIndex === targetIndex) {
        clearBlockDragState();
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      let insertAt = isAbove ? targetIndex : targetIndex + 1;
      const [moved] = blocks.splice(blockDragSrcIndex, 1);
      if (insertAt > blockDragSrcIndex) insertAt--;
      blocks.splice(insertAt, 0, moved);
      clearBlockDragState();
      renderBlocks();
      markDirty();
    }

    function handleBlockDragEnd() {
      clearBlockDragState();
    }

    // Field update handlers
    function updateField(el) {
      const i = parseInt(el.dataset.index);
      const field = el.dataset.field;
      blocks[i][field] = el.textContent;
      markDirty();
    }

    function updateLevel(index, level) {
      blocks[index].level = parseInt(level);
      markDirty();
    }

    function toggleOrdered(index, ordered) {
      blocks[index].ordered = ordered;
      renderBlocks();
      markDirty();
    }

    function addListItem(index) {
      blocks[index].items.push('');
      renderBlocks();
      markDirty();
    }

    function removeListItem(index, itemIndex) {
      blocks[index].items.splice(itemIndex, 1);
      renderBlocks();
      markDirty();
    }

    function updateListItem(el) {
      const i = parseInt(el.dataset.index);
      const j = parseInt(el.dataset.item);
      blocks[i].items[j] = el.textContent;
      markDirty();
    }

    function updateCodeLang(index, lang) {
      blocks[index].language = lang;
      markDirty();
    }

    function updateCode(index, code) {
      blocks[index].code = code;
      markDirty();
    }

    function updateImgField(index, field, value) {
      blocks[index][field] = value;
      renderBlocks();
      markDirty();
    }

    function updateHtml(index, html) {
      blocks[index].html = html;
      markDirty();
    }

    function updateTableHeader(el) {
      const i = parseInt(el.dataset.index);
      const j = parseInt(el.dataset.header);
      blocks[i].headers[j] = el.textContent;
      markDirty();
    }

    function updateTableCell(el) {
      const i = parseInt(el.dataset.index);
      const r = parseInt(el.dataset.row);
      const c = parseInt(el.dataset.col);
      blocks[i].rows[r][c] = el.textContent;
      markDirty();
    }

    // Add block menu
    function showAddMenu(afterIndex) {
      const menu = document.createElement('div');
      menu.className = 'add-block-menu';
      menu.innerHTML = BLOCK_TYPES.map(bt =>
        '<button class="add-block-option" onclick="addBlock(\\'' + bt.type + '\\',' + afterIndex + ');this.parentElement.remove()">' +
        '<span class="add-icon">' + bt.icon + '</span> ' + bt.label + '</button>'
      ).join('');
      const btn = event.target;
      btn.parentElement.appendChild(menu);
      setTimeout(() => document.addEventListener('click', function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
      }), 0);
    }

    // Insert media from sidebar
    function insertMedia(name, url) {
      const block = { id: genId(), type: 'image', src: name, alt: name.replace(/\\.[^.]+$/, '') };
      blocks.push(block);
      renderBlocks();
      markDirty();
    }

    // Upload a file co-located with this page
    function uploadPageMedia(e) {
      const file = e.target.files[0];
      if (!file) return;
      const input = e.target;
      const label = input.closest('label');
      if (label) { label.textContent = 'Uploading…'; label.style.pointerEvents = 'none'; }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('pagePath', ${JSON.stringify(pageData.sourcePath)});

      fetch('${prefix}/api/media/upload', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(result => {
          if (label) { label.innerHTML = 'Upload<input type="file" id="page-media-upload" style="display:none" accept="image/*,video/*,audio/*,.pdf,.zip,.csv,.json" onchange="uploadPageMedia(event)">'; label.style.pointerEvents = ''; }
          if (result.ok) {
            const item = result.item;
            const list = document.getElementById('page-media-list');
            const hint = list.querySelector('.media-empty-hint');
            if (hint) hint.remove();
            const div = document.createElement('div');
            div.className = 'media-item';
            const isImage = item.type.startsWith('image/');
            div.innerHTML = (isImage
              ? '<img src="' + item.url + '" alt="' + item.name + '" class="media-thumb">'
              : '<span class="media-file-icon">📎</span>') +
              '<span class="media-name" title="' + item.name + '">' + item.name + '</span>' +
              '<button class="btn btn-xs" onclick="insertMedia(' + JSON.stringify(item.name) + ',' + JSON.stringify(item.url) + ')" title="Insert into editor">+</button>';
            list.appendChild(div);
          } else {
            alert('Upload failed: ' + (result.error || 'Unknown error'));
          }
          input.value = '';
        })
        .catch(err => {
          if (label) { label.innerHTML = 'Upload<input type="file" id="page-media-upload" style="display:none" accept="image/*,video/*,audio/*,.pdf,.zip,.csv,.json" onchange="uploadPageMedia(event)">'; label.style.pointerEvents = ''; }
          alert('Upload error: ' + err.message);
          input.value = '';
        });
    }

    // Source/preview toggle
    function toggleSource() {
      sourceMode = !sourceMode;
      document.getElementById('block-editor').style.display = sourceMode ? 'none' : '';
      document.getElementById('source-editor').style.display = sourceMode ? '' : 'none';
      if (sourceMode) {
        // Serialize blocks to markdown for source view
        fetch('${prefix}/api/editor/serialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks }),
        })
        .then(r => r.json())
        .then(data => {
          document.getElementById('source-textarea').value = data.markdown || '';
        });
      } else {
        // Parse source back to blocks
        const src = document.getElementById('source-textarea').value;
        fetch('${prefix}/api/editor/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: src }),
        })
        .then(r => r.json())
        .then(data => {
          blocks = data.blocks || [];
          renderBlocks();
        });
      }
    }

    function togglePreview() {
      previewVisible = !previewVisible;
      document.getElementById('preview-panel').style.display = previewVisible ? '' : 'none';
      if (previewVisible) refreshPreview();
    }

    function refreshPreview() {
      // Get current content as markdown
      const getContent = sourceMode
        ? Promise.resolve(document.getElementById('source-textarea').value)
        : fetch('${prefix}/api/editor/serialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks }),
          }).then(r => r.json()).then(d => d.markdown || '');

      getContent.then(content => {
        fetch('${prefix}/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourcePath: ${JSON.stringify(pageData.sourcePath)},
            content,
            frontmatter: getFrontmatter(),
          }),
        })
        .then(r => r.text())
        .then(html => {
          const frame = document.getElementById('preview-frame');
          frame.srcdoc = html;
        });
      });
    }

    // Collect frontmatter from sidebar form.
    // Start from the full existing frontmatter so custom fields (taxonomy,
    // descriptor, metadata, collection, etc.) are preserved across saves.
    function getFrontmatter() {
      const fm = Object.assign({}, ${JSON.stringify(pageData.frontmatter)});
      fm.title = document.getElementById('fm-title').value;
      fm.template = document.getElementById('fm-template').value;
      const slug = document.getElementById('fm-slug').value;
      if (slug) fm.slug = slug; else delete fm.slug;
      fm.published = document.getElementById('fm-published').checked;
      const date = document.getElementById('fm-date').value;
      if (date) fm.date = date; else delete fm.date;

      // Collect taxonomy — preserve any non-configured taxonomy keys,
      // overlay configured ones from the tag inputs.
      const existingTax = (fm.taxonomy && typeof fm.taxonomy === 'object') ? Object.assign({}, fm.taxonomy) : {};
      for (const taxName of configuredTaxonomies) {
        const vals = taxonomyState[taxName] || [];
        if (vals.length > 0) existingTax[taxName] = vals;
        else delete existingTax[taxName];
      }
      if (Object.keys(existingTax).length > 0) fm.taxonomy = existingTax;
      else delete fm.taxonomy;

      // Collect blueprint custom fields
      for (const [fieldName, fieldType] of Object.entries(bpFields)) {
        const id = 'bp-' + fieldName;
        if (fieldType === 'toggle') {
          const el = document.getElementById(id);
          if (el) fm[fieldName] = el.checked;
        } else if (fieldType === 'number') {
          const el = document.getElementById(id);
          if (el) {
            const n = parseFloat(el.value);
            if (!isNaN(n)) fm[fieldName] = n;
            else delete fm[fieldName];
          }
        } else if (fieldType === 'list') {
          const vals = bpListState[fieldName] || [];
          if (vals.length > 0) fm[fieldName] = vals;
          else delete fm[fieldName];
        } else {
          // text, textarea, markdown, date, select, file, color
          const el = document.getElementById(id);
          if (el) {
            const val = el.value.trim();
            if (val) fm[fieldName] = val;
            else delete fm[fieldName];
          }
        }
      }

      return fm;
    }

    // Save
    function savePage() {
      // Client-side required-field check before hitting the network
      if (!validateBpRequired()) return;

      const getContent = sourceMode
        ? Promise.resolve(document.getElementById('source-textarea').value)
        : fetch('${prefix}/api/editor/serialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks }),
          }).then(r => r.json()).then(d => d.markdown || '');

      getContent.then(content => {
        const fm = getFrontmatter();
        return fetch('${prefix}/api/pages/${encodeURIComponent(pageData.sourcePath)}', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, frontmatter: fm }),
        });
      })
      .then(r => r.json())
      .then(result => {
        if (result.updated) {
          isDirty = false;
          clearBpErrors();
          document.querySelector('.editor-title').style.fontStyle = 'normal';
          if (previewVisible) refreshPreview();
        } else if (result.validationErrors && result.validationErrors.length > 0) {
          showBpValidationErrors(result.validationErrors);
        } else {
          alert('Save failed: ' + (result.error || 'Unknown error'));
        }
      })
      .catch(err => alert('Save error: ' + err.message));
    }

    // Utility
    function escapeHtml(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Warn on unsaved changes
    window.addEventListener('beforeunload', function(e) {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // ── Translation utilities ────────────────────────────────────────────────

    function toggleReference() {
      const panel = document.getElementById('editor-reference');
      if (!panel) return;
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      const btn = document.getElementById('ref-toggle');
      if (btn) {
        btn.classList.toggle('btn-outline', !opening);
        btn.classList.toggle('btn-primary', opening);
      }
    }

    function copyTMSuggestion(text) {
      navigator.clipboard.writeText(text).then(() => {
        const btn = event.target;
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {
        // Fallback: select text in a temporary textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = event.target;
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    }

    function createTranslation(sourcePath, lang) {
      const btn = event.target;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      fetch('${prefix}/api/pages/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath, lang }),
      })
      .then(r => r.json())
      .then(result => {
        if (result.created) {
          window.location.href = '${prefix}/pages/edit?path=' + encodeURIComponent(result.path);
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
          btn.disabled = false;
          btn.textContent = originalText;
        }
      })
      .catch(err => {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = originalText;
      });
    }

    // Init
    initEditor();
    initTaxonomy();
    initBlueprintFields();
  `;
}

function editorStyles(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #333; }

  .editor-layout { display: flex; flex-direction: column; height: 100vh; }

  /* Toolbar */
  .editor-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; background: #1a1a2e; color: #fff; }
  .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 0.5rem; }
  .editor-title { font-weight: 600; margin: 0 0.5rem; }
  .toolbar-rev-count { display: inline-block; background: rgba(255,255,255,0.25); color: #fff; border-radius: 10px; padding: 0 0.4rem; font-size: 0.7rem; font-weight: 700; line-height: 1.5; margin-left: 0.25rem; vertical-align: middle; }
  .btn { display: inline-block; padding: 0.4rem 0.8rem; border: none; border-radius: 4px; font-size: 0.85rem; cursor: pointer; text-decoration: none; color: inherit; }
  .btn-primary { background: #c9a96e; color: #fff; }
  .btn-primary:hover { background: #b8944f; }
  .btn-outline { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: #ccc; }
  .btn-outline:hover { background: rgba(255,255,255,0.1); }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .btn-xs { padding: 0.15rem 0.4rem; font-size: 0.75rem; }

  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; }
  .badge-md { background: #e8f4f8; color: #1a7a9b; }
  .badge-mdx { background: #f0e8f8; color: #7a1a9b; }
  .badge-tsx { background: #e8f8e8; color: #1a7a3b; }
  .badge-draft { background: #fff3cd; color: #856404; }

  /* Body layout */
  .editor-body { display: flex; flex: 1; overflow: hidden; }

  /* Sidebar */
  .editor-sidebar { width: 280px; background: #fff; border-right: 1px solid #e0e0e0; padding: 1rem; overflow-y: auto; flex-shrink: 0; }
  .editor-sidebar h4 { margin-bottom: 0.5rem; font-size: 0.85rem; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1rem; }
  .editor-sidebar h4:first-child { margin-top: 0; }
  .form-group { margin-bottom: 0.75rem; }
  .form-group label { display: block; margin-bottom: 0.2rem; font-size: 0.8rem; color: #555; }
  .form-group input[type="text"], .form-group input[type="date"], .form-group select {
    width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem;
  }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #c9a96e; }
  .info-row { font-size: 0.8rem; color: #666; margin-bottom: 0.25rem; }
  .info-row code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 2px; font-size: 0.75rem; }

  /* Media list */
  .media-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; }
  .media-empty-hint { font-size: 0.8rem; color: #999; margin: 0.25rem 0; }
  .media-list { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
  .media-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem; border-radius: 4px; }
  .media-item:hover { background: #f5f5f5; }
  .media-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 3px; }
  .media-file-icon { width: 32px; text-align: center; }
  .media-name { flex: 1; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Main editor */
  .editor-main { flex: 1; overflow-y: auto; padding: 1rem; }
  .editor-view { max-width: 800px; margin: 0 auto; }

  /* Block list */
  .block { margin-bottom: 0.5rem; background: #fff; border: 1px solid #e8e8e8; border-radius: 6px; transition: border-color 0.15s; }
  .block:hover { border-color: #c9a96e; }
  .block.dragging { opacity: 0.4; }
  .block.drag-over-top { border-top: 2px solid #c9a96e; }
  .block.drag-over-bottom { border-bottom: 2px solid #c9a96e; }
  .block-header { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.5rem; background: #fafafa; border-bottom: 1px solid #eee; border-radius: 6px 6px 0 0; }
  .block-drag-handle { cursor: grab; color: #ccc; font-size: 1rem; padding: 0 0.3rem 0 0; user-select: none; }
  .block-drag-handle:hover { color: #999; }
  .block-type-label { font-size: 0.7rem; color: #999; text-transform: uppercase; letter-spacing: 0.5px; flex: 1; }
  .block-controls { display: flex; gap: 0.15rem; }
  .block-action { background: none; border: none; cursor: pointer; padding: 0.1rem 0.3rem; font-size: 0.75rem; border-radius: 3px; color: #999; }
  .block-action:hover { background: #eee; color: #333; }
  .block-action-delete:hover { background: #fee; color: #c33; }
  .block-content { padding: 0.5rem; }
  .block-input { min-height: 1.5em; padding: 0.25rem; outline: none; border-radius: 3px; }
  .block-input:focus { background: #fffef5; }
  .block-heading { font-weight: 600; font-size: 1.2rem; }
  .block-add-below { text-align: center; padding: 0.15rem; opacity: 0; transition: opacity 0.15s; }
  .block:hover .block-add-below { opacity: 1; }

  /* Block-specific styles */
  .block-heading-row { display: flex; gap: 0.5rem; align-items: flex-start; }
  .block-level { width: 60px; padding: 0.2rem; border: 1px solid #ddd; border-radius: 3px; font-size: 0.8rem; }
  .block-quote-bar { border-left: 3px solid #c9a96e; padding-left: 0.75rem; }
  .block-code-editor { display: flex; flex-direction: column; gap: 0.25rem; }
  .code-lang { width: 120px; padding: 0.2rem 0.4rem; border: 1px solid #ddd; border-radius: 3px; font-size: 0.8rem; }
  .code-textarea { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.85rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 3px; min-height: 80px; resize: vertical; background: #1e1e1e; color: #d4d4d4; }
  .block-image-editor { display: flex; flex-direction: column; gap: 0.25rem; }
  .block-image-editor input { padding: 0.3rem 0.5rem; border: 1px solid #ddd; border-radius: 3px; font-size: 0.85rem; }
  .block-image-preview { max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 3px; margin-top: 0.25rem; }
  .block-divider { border: none; border-top: 2px solid #e0e0e0; margin: 0.5rem 0; }
  .block-table { width: 100%; border-collapse: collapse; }
  .block-table th, .block-table td { border: 1px solid #ddd; padding: 0.3rem 0.5rem; font-size: 0.85rem; }
  .block-table th { background: #f8f8f8; }
  .block-table [contenteditable] { outline: none; min-width: 40px; }
  .html-textarea { width: 100%; min-height: 60px; font-family: monospace; font-size: 0.85rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 3px; }
  .block-list-editor label { font-size: 0.8rem; color: #666; margin-bottom: 0.25rem; display: block; }
  .list-item-row { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.15rem; }
  .list-bullet { color: #999; font-size: 0.85rem; min-width: 20px; }
  .list-item-input { flex: 1; }

  /* Add block menu */
  .add-block-menu { position: absolute; background: #fff; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 0.25rem; z-index: 100; display: flex; flex-wrap: wrap; gap: 0.15rem; width: 280px; }
  .add-block-option { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.6rem; border: none; background: none; cursor: pointer; border-radius: 4px; font-size: 0.85rem; width: calc(50% - 0.1rem); }
  .add-block-option:hover { background: #f0f0f0; }
  .add-icon { font-size: 1rem; width: 20px; text-align: center; }
  .add-block-btn { margin-top: 0.5rem; }

  /* Source editor */
  .source-textarea { width: 100%; height: calc(100vh - 120px); font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.9rem; padding: 1rem; border: 1px solid #ddd; border-radius: 6px; resize: none; line-height: 1.6; }

  /* Preview panel */
  .editor-preview { width: 50%; border-left: 1px solid #e0e0e0; background: #fff; flex-shrink: 0; }
  .editor-preview iframe { width: 100%; height: 100%; border: none; }

  /* Modal */
  .modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .modal-content { position: relative; background: #fff; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-content h3 { margin-bottom: 1rem; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .form-actions .btn-outline { color: #666; border-color: #ddd; }

  .sidebar-section { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #eee; }

  /* Blueprint custom fields */
  .bp-textarea { width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; resize: vertical; min-height: 80px; font-family: inherit; }
  .bp-textarea:focus { outline: none; border-color: #c9a96e; }
  .toggle-label { display: flex !important; align-items: center; gap: 0.4rem; flex-direction: row !important; margin-bottom: 0 !important; }
  .toggle-label input[type="checkbox"] { width: auto; }
  .required-mark { color: #c33; font-weight: 700; }
  .form-group.bp-field-error > label { color: #b91c1c; }
  .form-group.bp-field-error input:not([type="checkbox"]),
  .form-group.bp-field-error select,
  .form-group.bp-field-error textarea,
  .form-group.bp-field-error .tag-input-wrapper { border-color: #f87171 !important; background: #fff8f8; }
  .bp-field-error-msg { color: #b91c1c; font-size: 0.78rem; margin-top: 0.2rem; }
  .color-row { display: flex; gap: 0.4rem; align-items: center; }
  .color-row input[type="color"] { width: 36px; height: 28px; padding: 1px 2px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
  .color-text { flex: 1; }

  /* Tag input (taxonomy) */
  .tag-input-wrapper { border: 1px solid #ddd; border-radius: 4px; padding: 0.25rem 0.3rem; min-height: 2rem; display: flex; flex-wrap: wrap; gap: 0.2rem; align-items: center; cursor: text; }
  .tag-input-wrapper:focus-within { border-color: #c9a96e; box-shadow: 0 0 0 2px rgba(201,169,110,0.15); }
  .tag-chips { display: contents; }
  .tag-chip { display: inline-flex; align-items: center; gap: 0.2rem; background: #eef2ff; color: #3b5bdb; border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 0.75rem; white-space: nowrap; }
  .tag-chip-remove { background: none; border: none; cursor: pointer; color: #3b5bdb; font-size: 1rem; line-height: 1; padding: 0 0.1rem; opacity: 0.6; }
  .tag-chip-remove:hover { opacity: 1; color: #c33; }
  .tag-input { border: none; outline: none; font-size: 0.82rem; padding: 0.1rem 0.2rem; min-width: 80px; flex: 1; background: transparent; }

  /* Translation sidebar */
  .badge-lang { background: #e8f4fd; color: #1a6fa8; font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 3px; font-weight: 600; display: inline-block; min-width: 2rem; text-align: center; }
  .badge-lang-current { background: #1a6fa8; color: #fff; }
  .badge-lang-missing { background: #f5f5f5; color: #aaa; }
  .translation-row { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.35rem; font-size: 0.85rem; }
  .translation-editing { font-size: 0.8rem; color: #999; }

  /* Reference panel */
  .editor-reference { border-bottom: 2px solid #e0e0e0; background: #fafafa; flex-shrink: 0; }
  .editor-reference-header { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: #555; border-bottom: 1px solid #e8e8e8; background: #f0f0f0; }
  .editor-reference-header .btn-xs { color: #666; border-color: #ccc; }
  .editor-reference-content { margin: 0; padding: 0.75rem; max-height: 280px; overflow-y: auto; font-size: 0.82rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: #333; }

  /* TM Suggestions sidebar section */
  .tm-suggestions-section { }
  .tm-badge { display: inline-block; background: #1a6fa8; color: #fff; font-size: 0.68rem; border-radius: 10px; padding: 0.05rem 0.4rem; margin-left: 0.25rem; vertical-align: middle; font-weight: 700; }
  .tm-hint { font-size: 0.75rem; color: #888; margin-bottom: 0.5rem; line-height: 1.4; }
  .tm-suggestion-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .tm-suggestion { background: #f0f7ff; border: 1px solid #c7dff7; border-radius: 4px; padding: 0.4rem 0.5rem; font-size: 0.78rem; }
  .tm-suggestion-source { color: #555; margin-bottom: 0.2rem; line-height: 1.4; word-break: break-word; }
  .tm-suggestion-target { color: #1a3a5c; font-weight: 500; line-height: 1.4; word-break: break-word; margin-bottom: 0.35rem; }
  .tm-copy-btn { display: block; width: 100%; text-align: center; }

  /* ── Mobile responsive ── */
  @media (max-width: 767px) {
    .editor-toolbar { flex-wrap: wrap; gap: 0.3rem; padding: 0.4rem 0.6rem; }
    .toolbar-left { flex: 1; min-width: 0; }
    .toolbar-right { flex-wrap: wrap; gap: 0.3rem; }
    .editor-title { font-size: 0.82rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .editor-body { flex-direction: column; overflow: auto; }
    .editor-sidebar {
      width: 100%;
      max-height: 40vh;
      border-right: none;
      border-bottom: 1px solid #e0e0e0;
      overflow-y: auto;
    }
    .editor-main { flex: none; min-height: 50vh; padding: 0.5rem; }
    .source-textarea { height: 50vh; }
    .editor-preview {
      width: 100%;
      height: 40vh;
      border-left: none;
      border-top: 1px solid #e0e0e0;
      flex-shrink: 0;
    }
    .editor-reference-content { max-height: 180px; }
  }
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
