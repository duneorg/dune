/**
 * Visual Page Builder UI.
 *
 * Layout:
 *  ┌────────────────────────────────────────────────────────┐
 *  │  toolbar (back / title / preview controls / save)      │
 *  ├──────────┬────────────────────────────┬────────────────┤
 *  │ palette  │   canvas                   │  page settings │
 *  │ (240px)  │   (flex-grow)              │  (280px)       │
 *  └──────────┴────────────────────────────┴────────────────┘
 *
 * Saves via PUT /admin/api/pages/{sourcePath} with sections in frontmatter.
 */

import type { SectionDef } from "../../sections/types.ts";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Data passed from the server into the builder page */
export interface BuilderPageData {
  sourcePath: string;
  route: string;
  title: string;
  published: boolean;
  slug: string;
  date: string;
  sections: unknown[];           // SectionInstance[] from frontmatter
  sectionDefs: SectionDef[];     // available section types
}

export function renderPageBuilderPage(
  prefix: string,
  userName: string,
  data: BuilderPageData,
): string {
  const sectionsJson = JSON.stringify(data.sections);
  const defsJson = JSON.stringify(data.sectionDefs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Builder: ${esc(data.title)} — Dune Admin</title>
  <style>${builderStyles()}</style>
</head>
<body>
<div class="bld-layout">

  <!-- Toolbar -->
  <header class="bld-toolbar">
    <div class="bld-toolbar-left">
      <a href="${prefix}/pages" class="btn btn-sm btn-outline">← Pages</a>
      <a href="${prefix}/pages/edit?path=${encodeURIComponent(data.sourcePath)}" class="btn btn-sm btn-outline">Classic Editor</a>
      <span class="bld-title">${esc(data.title)}</span>
    </div>
    <div class="bld-toolbar-center">
      <button class="btn btn-sm btn-outline bld-preview-btn active" onclick="setPreview('desktop')" title="Desktop preview">🖥</button>
      <button class="btn btn-sm btn-outline bld-preview-btn" onclick="setPreview('tablet')" title="Tablet preview">📱</button>
      <button class="btn btn-sm btn-outline bld-preview-btn" onclick="setPreview('mobile')" title="Mobile preview">📲</button>
    </div>
    <div class="bld-toolbar-right">
      <a href="${esc(data.route)}" target="_blank" class="btn btn-sm btn-outline">View →</a>
      <button class="btn btn-sm btn-primary" id="bld-save-btn" onclick="saveBuilder()">Save</button>
    </div>
  </header>

  <div class="bld-body">

    <!-- Section palette -->
    <aside class="bld-palette">
      <h4 class="bld-palette-title">Sections</h4>
      <div class="bld-palette-list" id="bld-palette"></div>
    </aside>

    <!-- Canvas -->
    <main class="bld-canvas-wrap">
      <div class="bld-canvas-scroller">
        <div class="bld-canvas" id="bld-canvas">
          <div class="bld-empty" id="bld-empty">
            <p>Drag a section from the left panel, or click its <strong>+</strong> button.</p>
          </div>
        </div>
      </div>
    </main>

    <!-- Page settings sidebar -->
    <aside class="bld-settings">
      <h4 class="bld-settings-title">Page Settings</h4>
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="bld-fm-title" value="${esc(data.title)}" onchange="markDirty()">
      </div>
      <div class="form-group">
        <label>Slug</label>
        <input type="text" id="bld-fm-slug" value="${esc(data.slug)}" placeholder="auto" onchange="markDirty()">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="bld-fm-date" value="${esc(data.date)}" onchange="markDirty()">
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="bld-fm-published" ${data.published ? "checked" : ""} onchange="markDirty()"> Published</label>
      </div>
      <hr style="margin:1rem 0;border:none;border-top:1px solid #e5e7eb">
      <p style="font-size:.8rem;color:#6b7280">Page uses <strong>page-builder</strong> layout. Sections below define the page content.</p>
    </aside>

  </div><!-- /bld-body -->
</div><!-- /bld-layout -->

<script>
// ── State ──────────────────────────────────────────────────────────────────
const PREFIX = ${JSON.stringify(prefix)};
const SOURCE_PATH = ${JSON.stringify(data.sourcePath)};
let sections = ${sectionsJson};
const defs = ${defsJson};
const defMap = Object.fromEntries(defs.map(d => [d.type, d]));
let isDirty = false;
let dragSrcIndex = null;

// ── Dirty tracking ─────────────────────────────────────────────────────────
function markDirty() { isDirty = true; document.getElementById('bld-save-btn').textContent = 'Save*'; }
function clearDirty() { isDirty = false; document.getElementById('bld-save-btn').textContent = 'Save'; }

window.addEventListener('beforeunload', e => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } });

// ── Helpers ────────────────────────────────────────────────────────────────
function genId() {
  return 'sec_' + Math.random().toString(36).slice(2, 9);
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getFieldValue(sectionId, fieldId) {
  const s = sections.find(s => s.id === sectionId);
  return s ? s[fieldId] : undefined;
}

// ── Preview sizing ─────────────────────────────────────────────────────────
function setPreview(mode) {
  const scroller = document.querySelector('.bld-canvas-scroller');
  document.querySelectorAll('.bld-preview-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (mode === 'desktop') scroller.style.maxWidth = '';
  else if (mode === 'tablet') scroller.style.maxWidth = '768px';
  else scroller.style.maxWidth = '390px';
}

// ── Palette ────────────────────────────────────────────────────────────────
function renderPalette() {
  const el = document.getElementById('bld-palette');
  el.innerHTML = defs.map(def => \`
    <div class="bld-palette-item" draggable="true"
         ondragstart="paletteDragStart(event, '\${escHtml(def.type)}')"
         onclick="addSection('\${escHtml(def.type)}')">
      <span class="bld-palette-icon">\${escHtml(def.icon)}</span>
      <div class="bld-palette-info">
        <span class="bld-palette-label">\${escHtml(def.label)}</span>
        <span class="bld-palette-desc">\${escHtml(def.description)}</span>
      </div>
      <button class="bld-palette-add" tabindex="-1" title="Add section">+</button>
    </div>
  \`).join('');
}

// ── Canvas rendering ───────────────────────────────────────────────────────
function renderCanvas() {
  const canvas = document.getElementById('bld-canvas');
  const empty = document.getElementById('bld-empty');
  if (sections.length === 0) {
    empty.style.display = '';
    // Remove section cards but keep the empty placeholder
    canvas.querySelectorAll('.bld-section-card').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  // Full re-render (simple — sections are few in practice)
  canvas.querySelectorAll('.bld-section-card').forEach(el => el.remove());
  sections.forEach((sec, idx) => {
    const def = defMap[sec.type];
    const card = buildSectionCard(sec, def, idx);
    canvas.appendChild(card);
  });
}

function buildSectionCard(sec, def, idx) {
  const card = document.createElement('div');
  card.className = 'bld-section-card';
  card.dataset.id = sec.id;
  card.dataset.idx = idx;
  card.draggable = true;

  // Drag events
  card.addEventListener('dragstart', e => { dragSrcIndex = idx; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); clearDropTargets(); });
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drop-target'); });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', e => { e.preventDefault(); card.classList.remove('drop-target'); moveSection(dragSrcIndex, idx); });

  const icon = def ? def.icon : '?';
  const label = def ? def.label : sec.type;
  const fields = def ? def.fields : [];

  card.innerHTML = \`
    <div class="bld-card-header" onclick="toggleCard(this)">
      <span class="bld-card-drag" title="Drag to reorder">⠿</span>
      <span class="bld-card-icon">\${escHtml(icon)}</span>
      <span class="bld-card-label">\${escHtml(label)}</span>
      <span class="bld-card-id">#\${escHtml(sec.id)}</span>
      <div class="bld-card-actions">
        <button onclick="moveSectionUp(\${idx});event.stopPropagation()" title="Move up" \${idx === 0 ? 'disabled' : ''}>↑</button>
        <button onclick="moveSectionDown(\${idx});event.stopPropagation()" title="Move down" \${idx === sections.length - 1 ? 'disabled' : ''}>↓</button>
        <button onclick="duplicateSection('\${escHtml(sec.id)}');event.stopPropagation()" title="Duplicate">⧉</button>
        <button onclick="removeSection('\${escHtml(sec.id)}');event.stopPropagation()" title="Remove" class="bld-btn-danger">✕</button>
      </div>
      <span class="bld-card-chevron">▾</span>
    </div>
    <div class="bld-card-body">
      \${renderFieldEditors(sec, fields)}
    </div>
  \`;

  return card;
}

function renderFieldEditors(sec, fields) {
  if (!fields.length) return '<p style="color:#9ca3af;font-size:.85rem;padding:.5rem 0">No configurable fields.</p>';
  return fields.map(field => renderField(sec, field)).join('');
}

function renderField(sec, field) {
  const val = sec[field.id] ?? field.default ?? '';
  const inputId = \`bf-\${sec.id}-\${field.id}\`;
  const onchange = \`updateField('\${escHtml(sec.id)}','\${escHtml(field.id)}',this)\`;

  let input = '';
  switch (field.type) {
    case 'textarea':
      input = \`<textarea id="\${inputId}" rows="3" onchange="\${onchange}" oninput="markDirty()">\${escHtml(val)}</textarea>\`;
      break;
    case 'richtext':
      input = \`<textarea id="\${inputId}" class="bld-richtext" rows="5" onchange="\${onchange}" oninput="markDirty()">\${escHtml(val)}</textarea>
               <p class="bld-richtext-hint">HTML accepted</p>\`;
      break;
    case 'toggle': {
      const checked = val === true || val === 'true' ? 'checked' : '';
      input = \`<label class="bld-toggle"><input type="checkbox" id="\${inputId}" \${checked} onchange="updateFieldBool('\${escHtml(sec.id)}','\${escHtml(field.id)}',this)"> \${escHtml(field.label)}</label>\`;
      return \`<div class="form-group bld-form-group">\${input}</div>\`;
    }
    case 'select': {
      const opts = (field.options || []).map(o =>
        \`<option value="\${escHtml(o.value)}" \${String(val) === o.value ? 'selected' : ''}>\${escHtml(o.label)}</option>\`
      ).join('');
      input = \`<select id="\${inputId}" onchange="\${onchange}">\${opts}</select>\`;
      break;
    }
    case 'number':
      input = \`<input type="number" id="\${inputId}" value="\${escHtml(val)}" onchange="\${onchange}" oninput="markDirty()">\`;
      break;
    case 'color':
      input = \`<input type="color" id="\${inputId}" value="\${escHtml(val || '#2563eb')}" onchange="\${onchange}">\`;
      break;
    case 'list':
      return renderListField(sec, field);
    default:
      input = \`<input type="text" id="\${inputId}" value="\${escHtml(val)}" placeholder="\${escHtml(field.placeholder || '')}" onchange="\${onchange}" oninput="markDirty()">\`;
  }
  return \`<div class="form-group bld-form-group"><label>\${escHtml(field.label)}\${field.required ? ' <span class="bld-required">*</span>' : ''}</label>\${input}</div>\`;
}

function renderListField(sec, field) {
  const items = Array.isArray(sec[field.id]) ? sec[field.id] : [];
  const itemRows = items.map((item, i) => renderListItem(sec.id, field, item, i)).join('');
  return \`
    <div class="form-group bld-form-group bld-list-field" data-sec="\${escHtml(sec.id)}" data-field="\${escHtml(field.id)}">
      <label>\${escHtml(field.label)}</label>
      <div class="bld-list-items" id="bld-list-\${escHtml(sec.id)}-\${escHtml(field.id)}">\${itemRows}</div>
      <button class="btn btn-sm btn-outline bld-list-add" onclick="addListItem('\${escHtml(sec.id)}','\${escHtml(field.id)}')">+ Add item</button>
    </div>
  \`;
}

function renderListItem(secId, field, item, idx) {
  const subFields = (field.itemFields || []).map(sub => {
    const v = item[sub.id] ?? sub.default ?? '';
    const iid = \`blf-\${secId}-\${field.id}-\${idx}-\${sub.id}\`;
    let inp = \`<input type="text" id="\${iid}" value="\${escHtml(v)}" placeholder="\${escHtml(sub.placeholder || '')}" onchange="updateListItem('\${escHtml(secId)}','\${escHtml(field.id)}',\${idx},'\${escHtml(sub.id)}',this)" oninput="markDirty()">\`;
    if (sub.type === 'textarea') {
      inp = \`<textarea id="\${iid}" rows="2" onchange="updateListItem('\${escHtml(secId)}','\${escHtml(field.id)}',\${idx},'\${escHtml(sub.id)}',this)" oninput="markDirty()">\${escHtml(v)}</textarea>\`;
    } else if (sub.type === 'toggle') {
      const chk = v === true || v === 'true' ? 'checked' : '';
      inp = \`<label class="bld-toggle"><input type="checkbox" id="\${iid}" \${chk} onchange="updateListItemBool('\${escHtml(secId)}','\${escHtml(field.id)}',\${idx},'\${escHtml(sub.id)}',this)"> \${escHtml(sub.label)}</label>\`;
    }
    return \`<div class="form-group bld-form-group bld-sub-field"><label>\${escHtml(sub.label)}</label>\${inp}</div>\`;
  }).join('');
  return \`
    <div class="bld-list-item" data-idx="\${idx}">
      <div class="bld-list-item-header">
        <span class="bld-list-item-num">Item \${idx + 1}</span>
        <button class="bld-list-remove" onclick="removeListItem('\${escHtml(secId)}','\${escHtml(field.id)}',\${idx})" title="Remove">✕</button>
      </div>
      \${subFields}
    </div>
  \`;
}

// ── Section operations ─────────────────────────────────────────────────────
function addSection(type) {
  const def = defMap[type];
  if (!def) return;
  const sec = { id: genId(), type };
  def.fields.forEach(f => {
    if (f.type === 'list') sec[f.id] = [];
    else if (f.type === 'toggle') sec[f.id] = f.default ?? false;
    else sec[f.id] = f.default ?? '';
  });
  sections.push(sec);
  markDirty();
  renderCanvas();
}

function removeSection(id) {
  if (!confirm('Remove this section?')) return;
  sections = sections.filter(s => s.id !== id);
  markDirty();
  renderCanvas();
}

function duplicateSection(id) {
  const idx = sections.findIndex(s => s.id === id);
  if (idx < 0) return;
  const copy = JSON.parse(JSON.stringify(sections[idx]));
  copy.id = genId();
  sections.splice(idx + 1, 0, copy);
  markDirty();
  renderCanvas();
}

function moveSectionUp(idx) {
  if (idx <= 0) return;
  [sections[idx - 1], sections[idx]] = [sections[idx], sections[idx - 1]];
  markDirty();
  renderCanvas();
}

function moveSectionDown(idx) {
  if (idx >= sections.length - 1) return;
  [sections[idx], sections[idx + 1]] = [sections[idx + 1], sections[idx]];
  markDirty();
  renderCanvas();
}

function moveSection(fromIdx, toIdx) {
  if (fromIdx === null || fromIdx === toIdx) return;
  const [item] = sections.splice(fromIdx, 1);
  sections.splice(toIdx, 0, item);
  dragSrcIndex = null;
  markDirty();
  renderCanvas();
}

function toggleCard(header) {
  const card = header.closest('.bld-section-card');
  card.classList.toggle('collapsed');
}

// ── Field updates ──────────────────────────────────────────────────────────
function updateField(secId, fieldId, el) {
  const s = sections.find(s => s.id === secId);
  if (s) { s[fieldId] = el.value; markDirty(); }
}
function updateFieldBool(secId, fieldId, el) {
  const s = sections.find(s => s.id === secId);
  if (s) { s[fieldId] = el.checked; markDirty(); }
}
function updateListItem(secId, fieldId, idx, subId, el) {
  const s = sections.find(s => s.id === secId);
  if (s && Array.isArray(s[fieldId])) { s[fieldId][idx][subId] = el.value; markDirty(); }
}
function updateListItemBool(secId, fieldId, idx, subId, el) {
  const s = sections.find(s => s.id === secId);
  if (s && Array.isArray(s[fieldId])) { s[fieldId][idx][subId] = el.checked; markDirty(); }
}

// ── List item operations ───────────────────────────────────────────────────
function addListItem(secId, fieldId) {
  const s = sections.find(s => s.id === secId);
  const def = defs.find(d => d.type === s?.type);
  const fDef = def?.fields.find(f => f.id === fieldId);
  if (!s || !fDef) return;
  if (!Array.isArray(s[fieldId])) s[fieldId] = [];
  const item = {};
  (fDef.itemFields || []).forEach(sub => { item[sub.id] = sub.default ?? ''; });
  s[fieldId].push(item);
  markDirty();
  // Re-render just the list container
  const listEl = document.getElementById(\`bld-list-\${secId}-\${fieldId}\`);
  if (listEl) listEl.innerHTML = s[fieldId].map((it, i) => renderListItem(secId, fDef, it, i)).join('');
}

function removeListItem(secId, fieldId, idx) {
  const s = sections.find(s => s.id === secId);
  if (!s || !Array.isArray(s[fieldId])) return;
  s[fieldId].splice(idx, 1);
  const def = defs.find(d => d.type === s.type);
  const fDef = def?.fields.find(f => f.id === fieldId);
  markDirty();
  const listEl = document.getElementById(\`bld-list-\${secId}-\${fieldId}\`);
  if (listEl && fDef) listEl.innerHTML = s[fieldId].map((it, i) => renderListItem(secId, fDef, it, i)).join('');
}

// ── Drag from palette ──────────────────────────────────────────────────────
function paletteDragStart(e, type) {
  e.dataTransfer.setData('palette-type', type);
}
document.getElementById('bld-canvas').addEventListener('dragover', e => { e.preventDefault(); });
document.getElementById('bld-canvas').addEventListener('drop', e => {
  const type = e.dataTransfer.getData('palette-type');
  if (type) { e.preventDefault(); addSection(type); }
});

function clearDropTargets() {
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

// ── Save ───────────────────────────────────────────────────────────────────
function saveBuilder() {
  const btn = document.getElementById('bld-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const fm = {
    title: document.getElementById('bld-fm-title').value.trim(),
    slug: document.getElementById('bld-fm-slug').value.trim() || undefined,
    date: document.getElementById('bld-fm-date').value || undefined,
    published: document.getElementById('bld-fm-published').checked,
    layout: 'page-builder',
    sections: sections,
  };
  // Remove undefined keys
  Object.keys(fm).forEach(k => { if (fm[k] === undefined) delete fm[k]; });

  fetch(\`\${PREFIX}/api/pages/\${encodeURIComponent(SOURCE_PATH)}\`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '', frontmatter: fm }),
  })
  .then(r => r.json())
  .then(result => {
    btn.disabled = false;
    if (result.updated) {
      clearDirty();
    } else {
      btn.textContent = 'Save';
      alert('Save failed: ' + (result.error || 'Unknown error'));
    }
  })
  .catch(err => {
    btn.disabled = false;
    btn.textContent = 'Save';
    alert('Save error: ' + err.message);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
renderPalette();
renderCanvas();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function builderStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; color: #1a1a1a; background: #f3f4f6; }
.bld-layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
/* Toolbar */
.bld-toolbar { display: flex; align-items: center; justify-content: space-between; padding: .5rem 1rem; background: #fff; border-bottom: 1px solid #e5e7eb; gap: 1rem; flex-shrink: 0; }
.bld-toolbar-left, .bld-toolbar-right { display: flex; align-items: center; gap: .5rem; }
.bld-toolbar-center { display: flex; gap: .25rem; }
.bld-title { font-weight: 600; font-size: .9rem; max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bld-preview-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
/* Body split */
.bld-body { display: flex; flex: 1; overflow: hidden; }
/* Palette */
.bld-palette { width: 240px; flex-shrink: 0; background: #fff; border-right: 1px solid #e5e7eb; overflow-y: auto; padding: .75rem; }
.bld-palette-title { font-size: .75rem; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: .05em; margin: 0 0 .75rem; }
.bld-palette-item { display: flex; align-items: center; gap: .5rem; padding: .5rem .6rem; border-radius: .375rem; cursor: pointer; border: 1px solid #e5e7eb; margin-bottom: .4rem; background: #f9fafb; transition: background .1s; }
.bld-palette-item:hover { background: #eff6ff; border-color: #bfdbfe; }
.bld-palette-icon { font-size: 1.25rem; flex-shrink: 0; }
.bld-palette-info { flex: 1; min-width: 0; }
.bld-palette-label { font-weight: 600; font-size: .8rem; display: block; }
.bld-palette-desc { font-size: .72rem; color: #9ca3af; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bld-palette-add { background: #2563eb; color: #fff; border: none; border-radius: .25rem; width: 1.4rem; height: 1.4rem; cursor: pointer; font-size: .9rem; line-height: 1; flex-shrink: 0; }
/* Canvas */
.bld-canvas-wrap { flex: 1; overflow: hidden; display: flex; flex-direction: column; align-items: center; padding: 1rem; }
.bld-canvas-scroller { width: 100%; max-width: 100%; overflow-y: auto; transition: max-width .2s; border-radius: .375rem; }
.bld-canvas { min-height: 100%; }
.bld-empty { text-align: center; padding: 4rem 2rem; color: #9ca3af; border: 2px dashed #d1d5db; border-radius: .5rem; background: #fff; margin: .5rem; }
.bld-empty p { margin: 0; font-size: .95rem; }
/* Section card */
.bld-section-card { background: #fff; border: 1px solid #e5e7eb; border-radius: .5rem; margin: .5rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); transition: border-color .15s; }
.bld-section-card.dragging { opacity: .5; }
.bld-section-card.drop-target { border-color: #2563eb; box-shadow: 0 0 0 2px #93c5fd; }
.bld-card-header { display: flex; align-items: center; gap: .5rem; padding: .7rem 1rem; cursor: pointer; user-select: none; }
.bld-card-header:hover { background: #f9fafb; border-radius: .5rem .5rem 0 0; }
.bld-card-drag { cursor: grab; color: #9ca3af; font-size: 1.1rem; flex-shrink: 0; }
.bld-card-icon { font-size: 1.1rem; flex-shrink: 0; }
.bld-card-label { font-weight: 600; font-size: .875rem; }
.bld-card-id { font-size: .72rem; color: #9ca3af; margin-left: .25rem; }
.bld-card-actions { margin-left: auto; display: flex; gap: .25rem; }
.bld-card-actions button { background: none; border: 1px solid #e5e7eb; border-radius: .25rem; padding: .15rem .4rem; cursor: pointer; font-size: .8rem; color: #6b7280; }
.bld-card-actions button:hover { background: #f3f4f6; }
.bld-card-actions button.bld-btn-danger:hover { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
.bld-card-actions button:disabled { opacity: .35; cursor: not-allowed; }
.bld-card-chevron { font-size: .75rem; color: #9ca3af; flex-shrink: 0; transition: transform .15s; }
.bld-section-card.collapsed .bld-card-chevron { transform: rotate(-90deg); }
.bld-card-body { padding: .75rem 1rem 1rem; border-top: 1px solid #f3f4f6; }
.bld-section-card.collapsed .bld-card-body { display: none; }
/* Form elements */
.form-group { margin-bottom: .75rem; }
.form-group label { display: block; font-size: .8rem; font-weight: 600; color: #374151; margin-bottom: .3rem; }
.form-group input[type=text], .form-group input[type=date], .form-group input[type=number], .form-group input[type=url], .form-group select, .form-group textarea { width: 100%; padding: .4rem .6rem; border: 1px solid #d1d5db; border-radius: .3rem; font-size: .875rem; font-family: inherit; }
.form-group input[type=checkbox] { margin-right: .3rem; }
.bld-form-group { margin-bottom: .6rem; }
.bld-richtext { font-family: "SF Mono", Monaco, monospace; font-size: .8rem; }
.bld-richtext-hint { font-size: .72rem; color: #9ca3af; margin: .2rem 0 0; }
.bld-required { color: #dc2626; }
.bld-toggle { display: flex; align-items: center; font-weight: 400; cursor: pointer; }
/* List fields */
.bld-list-items { margin-bottom: .5rem; }
.bld-list-item { border: 1px solid #e5e7eb; border-radius: .375rem; padding: .6rem .75rem; margin-bottom: .5rem; background: #f9fafb; }
.bld-list-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .4rem; }
.bld-list-item-num { font-size: .72rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
.bld-list-remove { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: .85rem; padding: 0; }
.bld-list-remove:hover { color: #dc2626; }
.bld-sub-field { margin-bottom: .4rem; }
.bld-sub-field label { font-size: .75rem; font-weight: 500; color: #6b7280; }
.bld-list-add { width: 100%; }
/* Settings sidebar */
.bld-settings { width: 280px; flex-shrink: 0; background: #fff; border-left: 1px solid #e5e7eb; overflow-y: auto; padding: .75rem 1rem; }
.bld-settings-title { font-size: .75rem; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: .05em; margin: 0 0 .75rem; }
.bld-settings .form-group input { width: 100%; }
/* Buttons */
.btn { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem .85rem; border-radius: .375rem; border: 1px solid transparent; cursor: pointer; font-size: .8rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
.btn-sm { padding: .3rem .65rem; font-size: .78rem; }
.btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn-primary:hover { background: #1d4ed8; }
.btn-outline { background: #fff; color: #374151; border-color: #d1d5db; }
.btn-outline:hover { background: #f3f4f6; }
`.trim();
}
