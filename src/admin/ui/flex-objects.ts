/**
 * Admin UI — Flex Objects (custom content types).
 *
 * Three views:
 *  1. Type list  — grid of defined Flex Object types
 *  2. Record list — table of all records for a given type
 *  3. Record editor — create / edit a single record
 */

import type { BlueprintField } from "../../blueprints/types.ts";
import type { FlexRecord, FlexSchema } from "../../flex/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeJs(str: string): string {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-CH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** First up-to-4 non-markdown fields — used as list table columns. */
function listColumns(schema: FlexSchema): string[] {
  return Object.entries(schema.fields)
    .filter(([, f]) => f.type !== "markdown")
    .slice(0, 4)
    .map(([name]) => name);
}

/** Format a field value for display in the list table. */
function displayValue(val: unknown): string {
  if (val === undefined || val === null || val === "") return "—";
  if (typeof val === "boolean") return val ? "✓" : "✗";
  if (Array.isArray(val)) return val.join(", ");
  const str = String(val);
  return str.length > 60 ? str.slice(0, 57) + "…" : str;
}

// ---------------------------------------------------------------------------
// 1. Type list
// ---------------------------------------------------------------------------

export function renderFlexTypeList(
  prefix: string,
  schemas: Record<string, FlexSchema>,
  recordCounts: Record<string, number>,
): string {
  const types = Object.entries(schemas);

  if (types.length === 0) {
    return `
    <div class="flex-empty-state">
      <div class="flex-empty-icon">🗂️</div>
      <h2>No Flex Objects defined</h2>
      <p>Create a <code>flex-objects/{type}.yaml</code> file in your project root to define a custom content type.</p>
      <pre class="flex-empty-example"># flex-objects/products.yaml
title: Products
icon: 🛍️
fields:
  name:
    type: text
    label: Product Name
    required: true
  price:
    type: number
    label: Price</pre>
    </div>`;
  }

  const cards = types.map(([type, schema]) => {
    const count = recordCounts[type] ?? 0;
    const icon = schema.icon ? escapeHtml(schema.icon) : "🗃️";
    return `
    <a href="${prefix}/flex/${encodeURIComponent(type)}" class="flex-type-card">
      <div class="flex-type-icon">${icon}</div>
      <div class="flex-type-info">
        <div class="flex-type-title">${escapeHtml(schema.title)}</div>
        <div class="flex-type-meta">${count} record${count !== 1 ? "s" : ""}${schema.description ? ` · ${escapeHtml(schema.description)}` : ""}</div>
      </div>
      <div class="flex-type-arrow">›</div>
    </a>`;
  }).join("");

  return `
  <div class="flex-header">
    <h2>Flex Objects</h2>
    <p class="flex-header-sub">Custom content types defined in <code>flex-objects/*.yaml</code></p>
  </div>
  <div class="flex-type-grid">${cards}</div>`;
}

// ---------------------------------------------------------------------------
// 2. Record list
// ---------------------------------------------------------------------------

export function renderFlexRecordList(
  prefix: string,
  type: string,
  schema: FlexSchema,
  records: FlexRecord[],
): string {
  const columns = listColumns(schema);
  const icon = schema.icon ? escapeHtml(schema.icon) : "🗃️";

  const thead = `<tr>
    ${columns.map((col) => `<th>${escapeHtml(schema.fields[col]?.label ?? col)}</th>`).join("")}
    <th>Created</th>
    <th></th>
  </tr>`;

  const tbody = records.length === 0
    ? `<tr><td colspan="${columns.length + 2}" class="flex-empty-row">No records yet. <a href="${prefix}/flex/${encodeURIComponent(type)}/new">Create the first one →</a></td></tr>`
    : records.map((rec) => `
    <tr>
      ${columns.map((col) => `<td>${escapeHtml(displayValue(rec[col]))}</td>`).join("")}
      <td class="flex-cell-date">${formatDate(rec._createdAt)}</td>
      <td class="flex-cell-actions">
        <a href="${prefix}/flex/${encodeURIComponent(type)}/${encodeURIComponent(rec._id)}" class="btn btn-xs btn-outline">Edit</a>
      </td>
    </tr>`).join("");

  return `
  <div class="flex-record-header">
    <div class="flex-record-header-left">
      <a href="${prefix}/flex" class="btn btn-sm btn-outline">← Types</a>
      <div>
        <h2>${icon} ${escapeHtml(schema.title)}</h2>
        ${schema.description ? `<p class="flex-type-desc">${escapeHtml(schema.description)}</p>` : ""}
      </div>
    </div>
    <a href="${prefix}/flex/${encodeURIComponent(type)}/new" class="btn btn-sm btn-primary">+ New record</a>
  </div>

  <table class="admin-table">
    <thead>${thead}</thead>
    <tbody>${tbody}</tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// 3. Record editor
// ---------------------------------------------------------------------------

function renderField(fieldName: string, field: BlueprintField, value: unknown): string {
  const id = `fx-${escapeAttr(fieldName)}`;
  const val = (value !== undefined && value !== null && value !== "") ? value : (field.default ?? "");
  const req = field.required ? " required" : "";

  const labelHtml = `<label for="${id}">${escapeHtml(field.label)}${field.required ? ' <span class="req">*</span>' : ""}</label>`;

  let widget: string;

  switch (field.type) {
    case "textarea":
    case "markdown":
      widget = `<textarea id="${id}" name="${escapeAttr(fieldName)}" rows="5"${req} oninput="markDirty()">${escapeHtml(String(val))}</textarea>`;
      break;

    case "number":
      widget = `<input type="number" id="${id}" name="${escapeAttr(fieldName)}" value="${escapeAttr(String(val === "" ? "" : val))}"${req} oninput="markDirty()"${field.validate?.min !== undefined ? ` min="${field.validate.min}"` : ""}${field.validate?.max !== undefined ? ` max="${field.validate.max}"` : ""}>`;
      break;

    case "toggle": {
      const checked = (val === true || val === "true" || val === 1 || val === "on") ? " checked" : "";
      widget = `<label class="toggle-label"><input type="checkbox" id="${id}" name="${escapeAttr(fieldName)}"${checked} onchange="markDirty()"> ${escapeHtml(field.label)}</label>`;
      // Toggle embeds its own label — skip outer label.
      return `<div class="form-group" id="fg-${escapeAttr(fieldName)}">${widget}<div class="flex-field-err" id="err-${escapeAttr(fieldName)}"></div></div>`;
    }

    case "date":
      widget = `<input type="date" id="${id}" name="${escapeAttr(fieldName)}" value="${escapeAttr(String(val))}"${req} onchange="markDirty()">`;
      break;

    case "color": {
      const colorVal = String(val) || "#000000";
      widget = `<div class="color-row"><input type="color" id="${id}-picker" value="${escapeAttr(colorVal)}" oninput="document.getElementById('${id}').value=this.value;markDirty()"><input type="text" id="${id}" name="${escapeAttr(fieldName)}" value="${escapeAttr(colorVal)}" placeholder="#rrggbb"${req} oninput="document.getElementById('${id}-picker').value=this.value||'#000000';markDirty()"></div>`;
      break;
    }

    case "select": {
      const opts = field.options ?? {};
      const optHtml = Object.entries(opts)
        .map(([k, label]) => `<option value="${escapeAttr(k)}"${String(val) === k ? " selected" : ""}>${escapeHtml(String(label))}</option>`)
        .join("");
      widget = `<select id="${id}" name="${escapeAttr(fieldName)}"${req} onchange="markDirty()"><option value="">— select —</option>${optHtml}</select>`;
      break;
    }

    case "list": {
      const items: string[] = Array.isArray(val) ? val.map(String) : [];
      const chips = items
        .map((item) => `<span class="chip"><span class="chip-text">${escapeHtml(item)}</span><button type="button" onclick="flexRemoveItem('${escapeAttr(fieldName)}',this)">&times;</button></span>`)
        .join("");
      const hiddens = items
        .map((item) => `<input type="hidden" name="${escapeAttr(fieldName)}[]" value="${escapeAttr(item)}">`)
        .join("");
      widget = `<div class="tag-input-wrapper" id="${id}-wrapper">
        <div class="tag-chips" id="${id}-chips">${chips}${hiddens}</div>
        <input type="text" class="tag-input" id="${id}-input" placeholder="Type and press Enter…"
               onkeydown="flexHandleListKey(event,'${escapeJs(fieldName)}')">
      </div>`;
      break;
    }

    default: // text, file
      widget = `<input type="text" id="${id}" name="${escapeAttr(fieldName)}" value="${escapeAttr(String(val))}"${req} oninput="markDirty()">`;
  }

  return `<div class="form-group" id="fg-${escapeAttr(fieldName)}">${labelHtml}${widget}<div class="flex-field-err" id="err-${escapeAttr(fieldName)}"></div></div>`;
}

export function renderFlexEditor(
  prefix: string,
  type: string,
  schema: FlexSchema,
  record: FlexRecord | null,
): string {
  const isNew = record === null;
  const icon = schema.icon ? escapeHtml(schema.icon) : "🗃️";

  const fields = Object.entries(schema.fields)
    .map(([fieldName, field]) => renderField(fieldName, field, record?.[fieldName]))
    .join("");

  const deleteBtn = !isNew
    ? `<button type="button" class="btn btn-sm btn-danger" onclick="flexDelete()">Delete</button>`
    : "";

  return `
  <div class="flex-editor-header">
    <a href="${prefix}/flex/${encodeURIComponent(type)}" class="btn btn-sm btn-outline">← ${escapeHtml(schema.title)}</a>
    <div>
      <h2>${icon} ${isNew ? "New" : "Edit"} ${escapeHtml(schema.title)}</h2>
      ${!isNew ? `<div class="flex-record-id">ID: <code>${escapeHtml(record!._id)}</code> · Updated ${formatDate(record!._updatedAt)}</div>` : ""}
    </div>
  </div>

  <div id="flex-notice"></div>

  <form id="flex-form" class="flex-editor-form" onsubmit="return false">
    <div class="flex-fields">${fields}</div>
    <div class="flex-editor-actions">
      <button type="button" class="btn btn-sm btn-primary" onclick="flexSave()">Save</button>
      ${deleteBtn}
    </div>
  </form>`;
}

// ---------------------------------------------------------------------------
// 4. Client-side script
// ---------------------------------------------------------------------------

export function flexScript(prefix: string, type: string, recordId: string | null): string {
  const isNew = recordId === null;
  const apiUrl = isNew
    ? `${prefix}/api/flex/${encodeURIComponent(type)}`
    : `${prefix}/api/flex/${encodeURIComponent(type)}/${encodeURIComponent(recordId!)}`;
  const deleteUrl = !isNew
    ? `${prefix}/api/flex/${encodeURIComponent(type)}/${encodeURIComponent(recordId!)}`
    : "";
  const listUrl = `${prefix}/flex/${encodeURIComponent(type)}`;

  return `
<script>
(function() {
  var dirty = false;
  window.markDirty = function() { dirty = true; };

  window.addEventListener('beforeunload', function(e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---- list widget ---- */
  window.flexHandleListKey = function(e, fieldName) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    var val = e.target.value.trim();
    if (!val) return;
    flexAddItem(fieldName, val);
    e.target.value = '';
    dirty = true;
  };

  window.flexAddItem = function(fieldName, val) {
    var id = 'fx-' + fieldName;
    var chips = document.getElementById(id + '-chips');
    var chip = document.createElement('span');
    chip.className = 'chip';
    var text = document.createElement('span');
    text.className = 'chip-text';
    text.textContent = val;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '&times;';
    btn.onclick = function() { flexRemoveItem(fieldName, btn); };
    chip.appendChild(text);
    chip.appendChild(btn);
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = fieldName + '[]';
    hidden.value = val;
    chip.appendChild(hidden);
    chips.appendChild(chip);
  };

  window.flexRemoveItem = function(fieldName, btn) {
    btn.closest('.chip').remove();
    dirty = true;
  };

  /* ---- collect ---- */
  function collectPayload() {
    var form = document.getElementById('flex-form');
    var data = {};
    var lists = {};
    var formData = new FormData(form);
    for (var pair of formData.entries()) {
      var key = pair[0], val = pair[1];
      if (key.endsWith('[]')) {
        var fieldName = key.slice(0, -2);
        if (!lists[fieldName]) lists[fieldName] = [];
        lists[fieldName].push(val);
      } else {
        data[key] = val;
      }
    }
    Object.assign(data, lists);
    // Unchecked checkboxes are absent from FormData — add them explicitly.
    form.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
      if (!cb.name.endsWith('[]')) data[cb.name] = cb.checked;
    });
    return data;
  }

  /* ---- notices & errors ---- */
  function showNotice(type, html) {
    var el = document.getElementById('flex-notice');
    el.className = 'flex-notice flex-notice-' + type;
    el.innerHTML = html;
    el.style.display = '';
  }

  function clearErrors() {
    document.querySelectorAll('.flex-field-err').forEach(function(el) { el.textContent = ''; });
    document.querySelectorAll('.form-group').forEach(function(el) { el.classList.remove('bp-field-error'); });
  }

  function showErrors(errors) {
    clearErrors();
    errors.forEach(function(err) {
      var errEl = document.getElementById('err-' + err.field);
      if (errEl) errEl.textContent = err.message;
      var fg = document.getElementById('fg-' + err.field);
      if (fg) fg.classList.add('bp-field-error');
    });
    if (errors.length) {
      var first = document.getElementById('fg-' + errors[0].field);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ---- save ---- */
  window.flexSave = async function() {
    clearErrors();
    var payload = collectPayload();
    try {
      var res = await fetch('${escapeJs(apiUrl)}', {
        method: '${isNew ? "POST" : "PUT"}',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var result = await res.json();
      if (!res.ok) {
        if (result.validationErrors) { showErrors(result.validationErrors); }
        else { showNotice('error', result.error || 'Save failed.'); }
        return;
      }
      dirty = false;
      if (${isNew ? "true" : "false"}) {
        window.location.href = '${escapeJs(listUrl)}/' + encodeURIComponent(result.record._id);
      } else {
        showNotice('success', 'Saved successfully.');
      }
    } catch(err) {
      showNotice('error', 'Network error: ' + err.message);
    }
  };

  /* ---- delete ---- */
  window.flexDelete = async function() {
    if (!confirm('Permanently delete this record?')) return;
    try {
      var res = await fetch('${escapeJs(deleteUrl)}', { method: 'DELETE' });
      if (res.ok) {
        dirty = false;
        window.location.href = '${escapeJs(listUrl)}';
      } else {
        var result = await res.json();
        showNotice('error', result.error || 'Delete failed.');
      }
    } catch(err) {
      showNotice('error', 'Network error: ' + err.message);
    }
  };
})();
</script>`;
}

// ---------------------------------------------------------------------------
// 5. CSS
// ---------------------------------------------------------------------------

export function flexStyles(): string {
  return `
  /* === Flex Objects === */
  .flex-header { margin-bottom: 1.5rem; }
  .flex-header h2 { margin-bottom: 0.25rem; }
  .flex-header-sub { color: #6b7280; font-size: 0.85rem; }

  .flex-type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .flex-type-card { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; text-decoration: none; color: inherit; transition: box-shadow 0.15s, border-color 0.15s; }
  .flex-type-card:hover { border-color: #c9a96e; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .flex-type-icon { font-size: 1.75rem; flex-shrink: 0; }
  .flex-type-info { flex: 1; min-width: 0; }
  .flex-type-title { font-weight: 600; font-size: 0.95rem; }
  .flex-type-meta { font-size: 0.8rem; color: #6b7280; margin-top: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flex-type-arrow { color: #9ca3af; font-size: 1.2rem; }

  .flex-empty-state { text-align: center; padding: 3rem 1rem; color: #6b7280; }
  .flex-empty-icon { font-size: 3rem; margin-bottom: 1rem; }
  .flex-empty-state h2 { color: #374151; margin-bottom: 0.5rem; }
  .flex-empty-state p { font-size: 0.9rem; margin-bottom: 1rem; }
  .flex-empty-example { text-align: left; display: inline-block; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; font-size: 0.8rem; max-width: 420px; white-space: pre; overflow-x: auto; }

  .flex-record-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap; }
  .flex-record-header-left { display: flex; align-items: center; gap: 0.75rem; }
  .flex-record-header h2 { margin: 0 0 0.1rem; }
  .flex-type-desc { font-size: 0.8rem; color: #9ca3af; margin: 0; }
  .flex-cell-date { font-size: 0.8rem; color: #9ca3af; white-space: nowrap; }
  .flex-cell-actions { white-space: nowrap; }
  .flex-empty-row { text-align: center; color: #9ca3af; padding: 2rem; }

  .flex-editor-header { display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .flex-editor-header h2 { margin: 0 0 0.2rem; }
  .flex-record-id { font-size: 0.78rem; color: #9ca3af; }
  .flex-editor-form { max-width: 640px; }
  .flex-fields { display: flex; flex-direction: column; gap: 1rem; }
  .flex-editor-actions { display: flex; gap: 0.5rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #f3f4f6; }

  .flex-notice { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
  .flex-notice-success { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .flex-notice-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

  .flex-field-err { color: #b91c1c; font-size: 0.78rem; margin-top: 0.25rem; min-height: 1em; }
  .form-group.bp-field-error > label { color: #b91c1c; }
  .form-group.bp-field-error input:not([type=checkbox]):not([type=color]),
  .form-group.bp-field-error select,
  .form-group.bp-field-error textarea,
  .form-group.bp-field-error .tag-input-wrapper { border-color: #f87171 !important; background: #fff8f8; }

  .color-row { display: flex; gap: 0.5rem; align-items: center; }
  .color-row input[type=color] { width: 2.5rem; height: 2.2rem; padding: 0.1rem; border-radius: 4px; cursor: pointer; border: 1px solid #d1d5db; }

  .toggle-label { display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer; user-select: none; }

  .form-group { display: flex; flex-direction: column; gap: 0.3rem; }
  .form-group > label { font-size: 0.85rem; font-weight: 600; color: #374151; }
  .form-group input:not([type=checkbox]):not([type=color]),
  .form-group select,
  .form-group textarea { padding: 0.45rem 0.6rem; border: 1px solid #d1d5db; border-radius: 5px; font-size: 0.875rem; width: 100%; font-family: inherit; }
  .form-group textarea { resize: vertical; }
  .req { color: #b91c1c; }

  .tag-input-wrapper { border: 1px solid #d1d5db; border-radius: 5px; padding: 0.3rem 0.4rem; min-height: 2.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; background: #fff; }
  .tag-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.2rem; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.1rem 0.35rem 0.1rem 0.5rem; font-size: 0.8rem; }
  .chip button { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 0.9rem; line-height: 1; padding: 0 0.1rem; }
  .chip button:hover { color: #b91c1c; }
  .tag-input { border: none; outline: none; font-size: 0.85rem; min-width: 120px; flex: 1; background: transparent; padding: 0.15rem 0; }
  `;
}
