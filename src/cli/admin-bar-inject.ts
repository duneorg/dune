/**
 * Admin bar injection — post-processes HTML responses to inject the admin
 * toolbar, edit-mode globals, and auto-overlay annotations when an admin
 * session cookie is active.
 *
 * Two passes run on the rendered HTML:
 *
 *   1. **Annotation pass** — adds `data-dune-field` / `data-dune-editable`
 *      attributes to standard elements (h1 → title, article/main → body) so
 *      the auto-overlay client script can activate inline editors without any
 *      template changes.  Elements with `data-dune-no-edit` are skipped.
 *      Elements already carrying `data-dune-*` attributes (from the
 *      `<EditableText>` component kit) are left untouched.
 *
 *   2. **Injection pass** — appends the admin bar HTML + auto-overlay client
 *      script before `</body>`.  The script is self-contained vanilla JS —
 *      no external imports, no Preact, no islands.
 *
 * Auto-overlay body editing uses a plain `<textarea>` with raw Markdown
 * (no TipTap).  TipTap is the feature of the explicit `<EditableMarkdown>`
 * island from `@dune/core/ui/editable`; the auto-overlay is intentionally
 * simpler — a fallback for pages that don't use the component kit.
 *
 * Works the same way as injectLiveReload / injectRtlDir: Response → Response.
 */

import type { SessionManager } from "../admin/auth/sessions.ts";
import type { DuneEngine } from "../core/engine.ts";

// ── Session cookie helper ─────────────────────────────────────────────────────

function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)dune_session=([^;]+)/);
  return match ? match[1] : null;
}

// ── HTML annotation pass ──────────────────────────────────────────────────────

/**
 * Annotate standard page elements with `data-dune-*` attributes so the
 * auto-overlay client script can activate inline editors without template
 * changes.
 *
 * Rules:
 * - Skip any element that already has a `data-dune-` attribute.
 * - Skip any element with `data-dune-no-edit`.
 * - `<h1>` → title field annotation (first occurrence only).
 * - `<article>`, `<main>`, or first `<div class="...content...">` → body annotation.
 */
function annotateEditableElements(html: string, sourcePath: string): string {
  const src = `data-dune-source="${escapeAttr(sourcePath)}"`;

  // Annotate the first <h1> that has no existing dune attribute and no
  // data-dune-no-edit.  Inject data-dune-field and data-dune-source.
  let annotated = html.replace(
    /(<h1\b)([^>]*?>)/,
    (_match, tag, rest) => {
      if (rest.includes("data-dune-")) return _match;
      return `${tag} data-dune-field="title" ${src}${rest}`;
    },
  );

  // Annotate the content container: <article>, <main>, or the first <div
  // class="...content..."> that has no existing dune attributes.
  const bodySelector =
    /(<(?:article|main)\b)([^>]*?>)|(<div\b[^>]*?\bclass="[^"]*\bcontent\b[^"]*"[^>]*?>)/;

  annotated = annotated.replace(bodySelector, (match) => {
    if (match.includes("data-dune-")) return match;
    if (match.includes("data-dune-no-edit")) return match;
    // Insert before the closing `>` of the opening tag.
    return match.replace(/>$/, ` data-dune-editable="body" ${src}>`);
  });

  return annotated;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Admin bar + auto-overlay HTML ─────────────────────────────────────────────

function buildAdminBarHtml(opts: {
  sourcePath: string;
  pageTitle: string;
  adminPrefix: string;
  userName: string;
}): string {
  const { sourcePath, pageTitle, adminPrefix, userName } = opts;
  const encodedPath = encodeURIComponent(sourcePath);
  const adminPageUrl = `${adminPrefix}/pages/${encodedPath}`;
  const commitUrl = `${adminPrefix}/api/content/${encodedPath}/commit`;
  const fieldsUrl = `${adminPrefix}/api/content/${encodedPath}/fields`;

  return `
<style>
  #dune-admin-bar {
    position: fixed; top: 0; left: 0; right: 0; height: 40px;
    background: #1a1a2e; color: #fff;
    display: flex; align-items: center; gap: 10px;
    padding: 0 16px; z-index: 99999;
    font: 13px/1 system-ui, sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
  }
  #dune-admin-bar .dune-ab-brand { font-weight: 700; color: #e2b96f; letter-spacing: .04em; }
  #dune-admin-bar .dune-ab-title {
    flex: 1; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; opacity: .7; max-width: 320px;
  }
  #dune-admin-bar button {
    border: none; border-radius: 4px; padding: 3px 12px;
    font-size: 12px; cursor: pointer;
  }
  #dune-ab-edit-toggle { background: #3498db; color: #fff; }
  #dune-ab-save { background: #27ae60; color: #fff; }
  #dune-ab-save:disabled { opacity: .6; cursor: default; }
  #dune-admin-bar .dune-ab-escape {
    color: rgba(255,255,255,.55); text-decoration: none;
    font-size: 12px; margin-left: auto;
  }
  #dune-admin-bar .dune-ab-user { font-size: 11px; opacity: .5; }
  body { padding-top: 40px !important; }

  /* Component-kit island show-on-hover */
  .dune-editable-text:hover .dune-edit-handle,
  .dune-editable-markdown:hover .dune-edit-handle--body { opacity: 1 !important; }

  /* Auto-overlay edit handles */
  .dune-ao-wrap { position: relative; display: inline; }
  .dune-ao-handle {
    position: absolute; top: -6px; right: -6px;
    background: #3498db; color: #fff;
    border: none; border-radius: 3px;
    padding: 1px 5px; font-size: 10px; cursor: pointer;
    opacity: 0; transition: opacity .15s;
    z-index: 1000;
  }
  .dune-ao-wrap:hover .dune-ao-handle { opacity: 1; }
  [data-dune-editable="body"] { position: relative; }
  .dune-ao-body-btn {
    position: absolute; top: 8px; right: 8px;
    background: #3498db; color: #fff;
    border: none; border-radius: 4px;
    padding: 4px 10px; font-size: 12px; cursor: pointer;
    opacity: 0; transition: opacity .15s;
    z-index: 1000;
  }
  [data-dune-editable="body"]:hover .dune-ao-body-btn { opacity: 1; }

  /* Inline body editor overlay */
  .dune-body-editor-wrap {
    position: relative; border: 2px solid #3498db;
    border-radius: 4px; padding: 4px;
  }
  .dune-body-editor-textarea {
    width: 100%; min-height: 200px;
    font: 14px/1.6 "SF Mono", Monaco, monospace;
    border: none; outline: none; resize: vertical;
    padding: 8px; box-sizing: border-box; background: #fff;
  }
  .dune-body-editor-toolbar {
    display: flex; gap: 8px; padding: 4px 8px;
    background: #f4f6f8; border-top: 1px solid #e0e4e8;
    font-size: 12px;
  }
  .dune-body-editor-toolbar button {
    padding: 3px 10px; border: none; border-radius: 3px;
    cursor: pointer; font-size: 12px;
  }
  .dune-status-saved { color: #2ecc71; }
  .dune-status-error { color: #e74c3c; }
</style>
<div id="dune-admin-bar">
  <span class="dune-ab-brand">✦ DUNE</span>
  <span class="dune-ab-title">${escapeHtml(pageTitle || sourcePath)}</span>
  <button id="dune-ab-edit-toggle">✎ Editing</button>
  <button id="dune-ab-save">Save</button>
  <a href="${adminPageUrl}" class="dune-ab-escape" title="Open full admin editor">Open in admin →</a>
  <span class="dune-ab-user">${escapeHtml(userName)}</span>
</div>
<script>
(function() {
  'use strict';

  // ── Globals ──────────────────────────────────────────────────────────────────
  window.__DUNE_EDIT_MODE__ = true;
  window.__DUNE_EDIT_SOURCE_PATH__ = ${JSON.stringify(sourcePath)};
  window.__DUNE_COMMIT_URL__ = ${JSON.stringify(commitUrl)};
  window.__DUNE_FIELDS_URL__ = ${JSON.stringify(fieldsUrl)};
  window.__DUNE_SOURCE_URL__ = ${JSON.stringify(commitUrl.replace('/commit', '/source'))};

  var editMode = true;

  // ── Admin bar buttons ─────────────────────────────────────────────────────────
  var saveBtn = document.getElementById('dune-ab-save');
  var toggleBtn = document.getElementById('dune-ab-edit-toggle');

  toggleBtn.addEventListener('click', function() {
    editMode = !editMode;
    window.__DUNE_EDIT_MODE__ = editMode;
    toggleBtn.textContent = editMode ? '✎ Editing' : '👁 Preview';
    toggleBtn.style.background = editMode ? '#3498db' : 'rgba(255,255,255,.15)';
    toggleBtn.style.border = editMode ? 'none' : '1px solid rgba(255,255,255,.2)';
    // Show/hide auto-overlay handles based on mode.
    document.querySelectorAll('.dune-ao-handle, .dune-ao-body-btn').forEach(function(el) {
      el.style.display = editMode ? '' : 'none';
    });
    window.dispatchEvent(new CustomEvent('dune:edit-mode-change', { detail: { mode: editMode ? 'edit' : 'preview' } }));
  });

  saveBtn.addEventListener('click', async function() {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      var res = await fetch(window.__DUNE_COMMIT_URL__, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      saveBtn.textContent = res.ok ? 'Saved ✓' : 'Error ✗';
      saveBtn.style.background = res.ok ? '#2ecc71' : '#e74c3c';
      setTimeout(function() {
        saveBtn.textContent = 'Save';
        saveBtn.style.background = '#27ae60';
        saveBtn.disabled = false;
      }, 2000);
    } catch(e) {
      saveBtn.textContent = 'Error ✗';
      saveBtn.style.background = '#e74c3c';
      saveBtn.disabled = false;
    }
  });

  // ── Auto-overlay activation ───────────────────────────────────────────────────
  // Runs after DOMContentLoaded. Skips elements that already carry the
  // component-kit island markers (they manage themselves).

  function patchField(fieldName, newValue) {
    return fetch(window.__DUNE_FIELDS_URL__, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [fieldName]: newValue } })
    });
  }

  var DEBOUNCE_MS = 600;

  function debounce(fn, ms) {
    var t;
    return function() {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function() { fn.apply(null, args); }, ms);
    };
  }

  function activateFieldElement(el) {
    // Skip if already activated or managed by the component kit.
    if (el.dataset.duneAoActive || el.closest('.dune-editable-text')) return;
    el.dataset.duneAoActive = '1';

    var fieldName = el.dataset.duneField;
    var wrap = document.createElement('span');
    wrap.className = 'dune-ao-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    // Edit handle button.
    var btn = document.createElement('button');
    btn.className = 'dune-ao-handle';
    btn.title = 'Edit ' + fieldName;
    btn.textContent = '✎';
    wrap.appendChild(btn);

    var statusEl = null;

    function showStatus(text, cls) {
      if (!statusEl) {
        statusEl = document.createElement('span');
        statusEl.style.cssText = 'position:absolute;bottom:-18px;right:0;font-size:10px;background:#333;color:#fff;border-radius:2px;padding:1px 4px;pointer-events:none;z-index:1001;';
        wrap.appendChild(statusEl);
      }
      statusEl.textContent = text;
      statusEl.className = cls || '';
      statusEl.style.display = 'inline';
    }

    function hideStatus() {
      if (statusEl) statusEl.style.display = 'none';
    }

    var saveDebounced = debounce(function(value) {
      showStatus('saving…', '');
      patchField(fieldName, value).then(function(res) {
        showStatus(res.ok ? 'saved' : 'error', res.ok ? 'dune-status-saved' : 'dune-status-error');
        setTimeout(hideStatus, 1500);
      }).catch(function() {
        showStatus('error', 'dune-status-error');
      });
    }, DEBOUNCE_MS);

    var originalContent = el.textContent;

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      el.contentEditable = 'true';
      el.style.outline = '2px solid #3498db';
      el.style.borderRadius = '2px';
      el.style.padding = '0 2px';
      el.focus();
    });

    el.addEventListener('input', function() {
      if (el.contentEditable === 'true') {
        saveDebounced(el.textContent);
      }
    });

    el.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        el.contentEditable = 'false';
        el.textContent = originalContent;
        el.style.outline = '';
        el.style.padding = '';
      }
    });

    el.addEventListener('blur', function() {
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.padding = '';
      originalContent = el.textContent;
    });
  }

  function activateBodyElement(el) {
    // Skip if already activated or managed by the component kit.
    if (el.dataset.duneAoBodyActive || el.closest('.dune-editable-markdown')) return;
    el.dataset.duneAoBodyActive = '1';

    // Edit button overlaid on the content area.
    var editBtn = document.createElement('button');
    editBtn.className = 'dune-ao-body-btn';
    editBtn.textContent = '✎ Edit';
    el.style.position = el.style.position || 'relative';
    el.appendChild(editBtn);

    var originalHtml = el.innerHTML.replace(editBtn.outerHTML, '').trim();

    editBtn.addEventListener('click', async function() {
      editBtn.textContent = 'Loading…';
      editBtn.disabled = true;

      // Fetch the raw Markdown body from the source endpoint.
      var initialBody = '';
      try {
        var srcRes = await fetch(window.__DUNE_SOURCE_URL__, { credentials: 'include' });
        if (srcRes.ok) {
          var srcData = await srcRes.json();
          initialBody = srcData.body || '';
        }
      } catch(e) { /* use empty textarea on error */ }

      editBtn.textContent = '✎ Edit';
      editBtn.disabled = false;

      var editorWrap = document.createElement('div');
      editorWrap.className = 'dune-body-editor-wrap';

      var textarea = document.createElement('textarea');
      textarea.className = 'dune-body-editor-textarea';
      textarea.value = initialBody;
      textarea.placeholder = 'Markdown content…';

      var toolbar = document.createElement('div');
      toolbar.className = 'dune-body-editor-toolbar';

      var saveBodyBtn = document.createElement('button');
      saveBodyBtn.textContent = 'Save';
      saveBodyBtn.style.cssText = 'background:#27ae60;color:#fff;';

      var cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background:#eee;color:#333;';

      var statusSpan = document.createElement('span');

      toolbar.appendChild(saveBodyBtn);
      toolbar.appendChild(cancelBtn);
      toolbar.appendChild(statusSpan);
      editorWrap.appendChild(textarea);
      editorWrap.appendChild(toolbar);

      // Replace content area with editor.
      el.innerHTML = '';
      el.appendChild(editorWrap);

      saveBodyBtn.addEventListener('click', async function() {
        saveBodyBtn.disabled = true;
        saveBodyBtn.textContent = 'Saving…';
        statusSpan.textContent = '';
        try {
          // Write the new body into the Y.js doc via the body field,
          // then commit immediately.  Since we skip Y.js here (no realtime
          // needed for this simple flow), we write the body via a special
          // _body field key the server understands.
          var patchRes = await fetch(window.__DUNE_FIELDS_URL__, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { __body: textarea.value } })
          });
          if (!patchRes.ok) throw new Error('Patch failed: ' + patchRes.status);
          var commitRes = await fetch(window.__DUNE_COMMIT_URL__, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          if (commitRes.ok) {
            statusSpan.textContent = 'Saved ✓';
            statusSpan.className = 'dune-status-saved';
            setTimeout(function() { location.reload(); }, 800);
          } else {
            throw new Error('Commit failed: ' + commitRes.status);
          }
        } catch(err) {
          statusSpan.textContent = 'Error: ' + err.message;
          statusSpan.className = 'dune-status-error';
          saveBodyBtn.disabled = false;
          saveBodyBtn.textContent = 'Save';
        }
      });

      cancelBtn.addEventListener('click', function() {
        el.innerHTML = originalHtml;
        el.appendChild(editBtn);
      });
    });
  }

  function activateOverlay() {
    // Activate text field elements.
    document.querySelectorAll('[data-dune-field]').forEach(activateFieldElement);
    // Activate body elements.
    document.querySelectorAll('[data-dune-editable="body"]').forEach(activateBodyElement);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateOverlay);
  } else {
    activateOverlay();
  }

  // Re-run if edit mode is toggled back on after being turned off.
  window.addEventListener('dune:edit-mode-change', function(e) {
    if (e.detail && e.detail.mode === 'edit') activateOverlay();
  });

})();
</script>`;
}

// ── Public helper ─────────────────────────────────────────────────────────────

/**
 * Check if the request carries a valid admin session; if so, annotate standard
 * page elements with `data-dune-*` attributes and inject the admin bar HTML
 * before `</body>` in the response.
 *
 * Returns the original response unchanged when:
 * - The response is not HTML
 * - No admin session cookie is present
 * - The session is expired or invalid
 * - The request is for an admin path
 */
export async function injectAdminBarIfAdmin(
  req: Request,
  response: Response,
  sessions: SessionManager,
  engine: DuneEngine,
  adminPrefix: string,
): Promise<Response> {
  // Only inject into HTML responses.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // Never inject into admin paths.
  const url = new URL(req.url);
  if (url.pathname.startsWith(adminPrefix)) return response;

  // Check session cookie.
  const token = getSessionToken(req);
  if (!token) return response;

  let session: Awaited<ReturnType<SessionManager["get"]>>;
  try {
    session = await sessions.get(token);
  } catch {
    return response;
  }
  if (!session) return response;

  // Find the content page for this URL.
  const page = engine.pages.find((p) => p.route === url.pathname);
  if (!page?.sourcePath) return response;

  const { sourcePath } = page;
  const barHtml = buildAdminBarHtml({
    sourcePath,
    pageTitle: page.title ?? page.route,
    adminPrefix,
    userName: session.userId,
  });

  // Buffer the full response body so we can run both passes (annotation +
  // injection) over the complete HTML string.  Content pages are typically
  // <100 KB, so buffering here is fine.
  if (!response.body) return response;

  const bodyBytes = await response.arrayBuffer();
  let html = new TextDecoder().decode(bodyBytes);

  // Pass 1: annotate standard elements for auto-overlay.
  html = annotateEditableElements(html, sourcePath);

  // Pass 2: inject admin bar before </body>.
  if (html.includes("</body>")) {
    html = html.replace("</body>", `${barHtml}</body>`);
  } else if (html.includes("</html>")) {
    html = html.replace("</html>", `${barHtml}</html>`);
  } else {
    html = html + barHtml;
  }

  const encoded = new TextEncoder().encode(html);
  const headers = new Headers(
    [...response.headers.entries()].filter(
      ([k]) => k.toLowerCase() !== "content-length",
    ),
  );
  headers.set("Content-Length", String(encoded.byteLength));

  return new Response(encoded, { status: response.status, headers });
}
