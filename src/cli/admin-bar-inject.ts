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

import type { AuthMiddleware } from "../admin/auth/middleware.ts";
import type { DuneEngine } from "../core/engine.ts";

// ── Session cookie helper ─────────────────────────────────────────────────────

/**
 * Cheap check for the presence of an admin session cookie — no validation.
 *
 * Used by the page-cache layer to decide whether a request may share the
 * anonymous page cache: any request carrying a session cookie must bypass
 * both cache read and write, otherwise a bar-injected response (admin
 * username, edit chrome, content API URLs) gets stored under the plain
 * pathname key and served to anonymous visitors.
 */
export function hasAdminSessionCookie(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)dune_session=[^;]+/.test(cookie);
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
 * - `<article>` or first `<div class="...content...">` → body annotation.
 *   (`<main>` is excluded — it is a layout wrapper, not a content element.)
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

  // Annotate the first content container that has no existing dune attributes
  // and no data-dune-no-edit opt-out.  Uses the `g` flag so skipped elements
  // don't block the scan.
  //
  // <main> is intentionally excluded: it is a layout wrapper (typically
  // contains nav, header, footer as well as content) and is almost never the
  // right annotation target.  Themes that want <main> to be editable should
  // add data-dune-editable="body" explicitly.
  //
  // The class regex uses (?!-) to avoid matching "content" in hyphenated
  // compound class names like "content-header" or "main-content".  Word
  // boundary \b fires at the t/- transition (hyphen is non-\w), so the extra
  // negative lookahead is required to reject those cases.
  const bodySelector =
    /(<article\b)([^>]*?>)|(<div\b[^>]*?\bclass="[^"]*\bcontent(?!-)[^"]*"[^>]*?>)/g;

  let bodyAnnotated = false;
  annotated = annotated.replace(bodySelector, (match) => {
    if (bodyAnnotated) return match; // already found and annotated one — leave rest untouched
    if (match.includes("data-dune-")) return match; // skip opt-outs and already-annotated elements
    bodyAnnotated = true;
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

/**
 * JSON-encode a string for safe embedding inside an inline `<script>` block.
 *
 * `JSON.stringify` alone preserves `<` and `>` literally, so a value like
 * `"</script>"` would break out of the script tag.  Escaping `<` as `<`
 * and `>` as `>` keeps the JSON semantically identical while making it
 * safe to embed in HTML.
 */
function jsonStr(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
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

  /* Auto-overlay — component-kit island compatibility */
  .dune-ao-wrap { position: relative; display: inline; }
  .dune-ao-handle {
    position: absolute; top: -6px; right: -6px;
    background: #3498db; color: #fff;
    border: none; border-radius: 3px;
    padding: 1px 5px; font-size: 10px; cursor: pointer;
    opacity: 0; transition: opacity .15s; z-index: 1000;
  }
  .dune-ao-wrap:hover .dune-ao-handle { opacity: 1; }

  /* Auto-overlay — click-to-edit indicators (active when edit mode is on) */
  body.dune-edit-mode [data-dune-field] { cursor: text; }
  body.dune-edit-mode [data-dune-field]:not([contenteditable="true"]):hover {
    outline: 2px dashed rgba(52,152,219,.5); outline-offset: 2px;
  }
  [data-dune-field][contenteditable="true"] {
    outline: 2px solid #3498db !important; outline-offset: 2px; border-radius: 2px;
  }
  body.dune-edit-mode [data-dune-body-editable]:not([contenteditable="true"]):hover {
    outline: 2px dashed rgba(52,152,219,.35); outline-offset: 4px; cursor: text;
  }
  [data-dune-body-editable][contenteditable="true"] {
    outline: 2px solid #3498db; outline-offset: 4px;
  }

  /* Floating sticky toolbar shown while body editing is active */
  .dune-ao-body-toolbar {
    height: 0; overflow: visible; position: sticky; top: 50px;
    text-align: right; pointer-events: none; z-index: 1001;
  }
  .dune-ao-body-toolbar-inner {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; pointer-events: all;
    background: #1a1a2e; border-radius: 0 0 6px 6px; font-size: 12px;
  }
  .dune-ao-body-toolbar button {
    border: none; border-radius: 4px; padding: 3px 10px;
    font-size: 12px; cursor: pointer; color: #fff;
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
  window.__DUNE_EDIT_SOURCE_PATH__ = ${jsonStr(sourcePath)};
  window.__DUNE_COMMIT_URL__ = ${jsonStr(commitUrl)};
  window.__DUNE_FIELDS_URL__ = ${jsonStr(fieldsUrl)};
  window.__DUNE_SOURCE_URL__ = ${jsonStr(commitUrl.replace('/commit', '/source'))};

  var editMode = true;
  document.body.classList.add('dune-edit-mode');

  // ── Admin bar buttons ─────────────────────────────────────────────────────────
  var saveBtn = document.getElementById('dune-ab-save');
  var toggleBtn = document.getElementById('dune-ab-edit-toggle');

  toggleBtn.addEventListener('click', function() {
    editMode = !editMode;
    window.__DUNE_EDIT_MODE__ = editMode;
    toggleBtn.textContent = editMode ? '✎ Editing' : '👁 Preview';
    toggleBtn.style.background = editMode ? '#3498db' : 'rgba(255,255,255,.15)';
    toggleBtn.style.border = editMode ? 'none' : '1px solid rgba(255,255,255,.2)';
    document.body.classList.toggle('dune-edit-mode', editMode);
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
    if (el.dataset.duneAoActive || el.closest('.dune-editable-text')) return;
    el.dataset.duneAoActive = '1';

    var fieldName = el.dataset.duneField;
    var originalContent = el.textContent;

    var saveDebounced = debounce(function(value) {
      patchField(fieldName, value).catch(function() {});
    }, DEBOUNCE_MS);

    // Click directly on the element to start editing — no separate button.
    el.addEventListener('click', function(e) {
      if (!editMode || el.contentEditable === 'true') return;
      e.stopPropagation();
      el.contentEditable = 'true';
      el.focus();
    });

    el.addEventListener('input', function() {
      if (el.contentEditable === 'true') saveDebounced(el.textContent);
    });

    el.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        el.contentEditable = 'false';
        el.textContent = originalContent;
      }
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });

    el.addEventListener('blur', function() {
      if (el.contentEditable !== 'true') return;
      el.contentEditable = 'false';
      originalContent = el.textContent;
    });
  }

  // Convert an HTML fragment to Markdown.  Handles the common elements produced
  // by contenteditable editing.  Uses String.fromCharCode(10) for newlines and
  // avoids all backslash escape sequences — template literal safety.
  function htmlToMarkdown(html) {
    var nl = String.fromCharCode(10);
    var div = document.createElement('div');
    div.innerHTML = html;
    function walk(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      var tag = node.tagName.toLowerCase();
      var inner = Array.from(node.childNodes).map(walk).join('');
      if (tag === 'p') return inner.trim() + nl + nl;
      if (tag === 'br') return nl;
      if (tag === 'h1') return '# ' + inner.trim() + nl + nl;
      if (tag === 'h2') return '## ' + inner.trim() + nl + nl;
      if (tag === 'h3') return '### ' + inner.trim() + nl + nl;
      if (tag === 'h4') return '#### ' + inner.trim() + nl + nl;
      if (tag === 'h5') return '##### ' + inner.trim() + nl + nl;
      if (tag === 'h6') return '###### ' + inner.trim() + nl + nl;
      if (tag === 'strong' || tag === 'b') return '**' + inner + '**';
      if (tag === 'em' || tag === 'i') return '_' + inner + '_';
      if (tag === 'code') return '\`' + inner + '\`';
      if (tag === 'pre') return '\`\`\`' + nl + node.textContent + nl + '\`\`\`' + nl + nl;
      if (tag === 'blockquote') return inner.trim().split(nl).map(function(l) { return '> ' + l; }).join(nl) + nl + nl;
      if (tag === 'a') return '[' + inner + '](' + (node.getAttribute('href') || '') + ')';
      if (tag === 'img') return '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
      if (tag === 'ul') return Array.from(node.children).map(function(li) { return '- ' + walk(li).trim(); }).join(nl) + nl + nl;
      if (tag === 'ol') return Array.from(node.children).map(function(li, i) { return (i + 1) + '. ' + walk(li).trim(); }).join(nl) + nl + nl;
      if (tag === 'li') return inner;
      if (tag === 'hr') return '---' + nl + nl;
      if (tag === 'div') return inner + (inner.slice(-1) === nl ? '' : nl);
      return inner;
    }
    var result = walk(div).trim();
    var triple = nl + nl + nl;
    while (result.indexOf(triple) !== -1) result = result.split(triple).join(nl + nl);
    return result;
  }

  function activateBodyElement(el) {
    if (el.dataset.duneAoBodyActive || el.closest('.dune-editable-markdown')) return;
    el.dataset.duneAoBodyActive = '1';

    // editEl: the specific child of el that contains the rendered body text.
    // Starts as el itself, refined to a child after the source fetch locates the body.
    var editEl = el;
    var bodyLocated = false;

    function locateBodyElement() {
      return fetch(window.__DUNE_SOURCE_URL__, { credentials: 'include' })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
          if (data && data.body) {
            var nl = String.fromCharCode(10);
            var lines = data.body.split(nl);
            var needle = '';
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (line.length < 16 || line[0] === '#' || line.slice(0, 3) === '---' || line[0] === '!' || line[0] === '[') continue;
              var j = 0;
              while (j < line.length && (line[j] === '*' || line[j] === '_')) j++;
              var candidate = line.slice(j, j + 40).trim();
              if (candidate.length > 10) { needle = candidate; break; }
            }
            if (needle) {
              var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
              var n;
              while ((n = w.nextNode())) {
                if (n.textContent.indexOf(needle) !== -1) {
                  var target = n.parentNode;
                  while (target && target.parentNode !== el) { target = target.parentNode; }
                  if (target) editEl = target;
                  break;
                }
              }
            }
          }
          editEl.dataset.duneBodyEditable = '1';
          bodyLocated = true;
        })
        .catch(function() { editEl.dataset.duneBodyEditable = '1'; bodyLocated = true; });
    }

    // Click directly on the body content element to start editing.
    // The body-location fetch is deferred to first interaction so it doesn't
    // fire a GET on every admin page load.
    el.addEventListener('click', async function(e) {
      if (!editMode) return;
      if (!bodyLocated) await locateBodyElement();
      if (!editEl.contains(e.target) || e.target.closest('.dune-ao-body-toolbar')) return;
      if (editEl.contentEditable === 'true') return;
      e.stopPropagation();

      var originalBodyHtml = editEl.innerHTML;
      editEl.contentEditable = 'true';
      editEl.focus();

      // Floating sticky toolbar at the top of editEl.
      var toolbar = document.createElement('div');
      toolbar.className = 'dune-ao-body-toolbar';
      var toolbarInner = document.createElement('div');
      toolbarInner.className = 'dune-ao-body-toolbar-inner';
      var saveBodyBtn = document.createElement('button');
      saveBodyBtn.textContent = 'Save';
      saveBodyBtn.style.background = '#27ae60';
      var cancelBodyBtn = document.createElement('button');
      cancelBodyBtn.textContent = 'Cancel';
      cancelBodyBtn.style.background = 'rgba(255,255,255,.15)';
      var statusSpan = document.createElement('span');
      statusSpan.style.cssText = 'color:#fff;font-size:11px;margin-left:4px;';
      toolbarInner.appendChild(saveBodyBtn);
      toolbarInner.appendChild(cancelBodyBtn);
      toolbarInner.appendChild(statusSpan);
      toolbar.appendChild(toolbarInner);
      editEl.insertBefore(toolbar, editEl.firstChild);

      function deactivate() {
        editEl.contentEditable = 'false';
        if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
      }

      saveBodyBtn.addEventListener('click', async function() {
        saveBodyBtn.disabled = true;
        saveBodyBtn.textContent = 'Saving…';
        // Snapshot content without the toolbar before converting.
        var clone = editEl.cloneNode(true);
        var tb = clone.querySelector('.dune-ao-body-toolbar');
        if (tb) tb.parentNode.removeChild(tb);
        var md = htmlToMarkdown(clone.innerHTML);
        try {
          var pr = await fetch(window.__DUNE_FIELDS_URL__, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { __body: md } })
          });
          if (!pr.ok) throw new Error('patch');
          var cr = await fetch(window.__DUNE_COMMIT_URL__, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: '{}'
          });
          if (!cr.ok) throw new Error('commit');
          statusSpan.textContent = 'Saved ✓';
          statusSpan.className = 'dune-status-saved';
          setTimeout(function() { location.reload(); }, 800);
        } catch(err) {
          statusSpan.textContent = 'Error';
          statusSpan.className = 'dune-status-error';
          saveBodyBtn.disabled = false;
          saveBodyBtn.textContent = 'Save';
        }
      });

      // Declare onEscKey before the cancel handler so both can reference it.
      var onEscKey;
      cancelBodyBtn.addEventListener('click', function() {
        editEl.innerHTML = originalBodyHtml;
        editEl.removeEventListener('keydown', onEscKey);
        deactivate();
      });

      onEscKey = function(e) {
        if (e.key === 'Escape') {
          editEl.innerHTML = originalBodyHtml;
          deactivate();
          editEl.removeEventListener('keydown', onEscKey);
        }
      };
      editEl.addEventListener('keydown', onEscKey);
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
 * Check if the request carries a valid admin session with edit rights; if so,
 * annotate standard page elements with `data-dune-*` attributes and inject the
 * admin bar HTML before `</body>` in the response.
 *
 * Authentication goes through the full AuthMiddleware (not a bare session
 * lookup) so a revoked, expired, or disabled account never sees the bar, and
 * the `pages.update` permission gate keeps edit chrome away from accounts
 * that could not save anyway.
 *
 * Returns the original response unchanged when:
 * - The response is not HTML
 * - The request is for an admin path
 * - No admin session cookie is present
 * - The session is invalid, the user is missing/disabled, or lacks pages.update
 */
export async function injectAdminBarIfAdmin(
  req: Request,
  response: Response,
  auth: AuthMiddleware,
  engine: DuneEngine,
  adminPrefix: string,
): Promise<Response> {
  // Only inject into HTML responses.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // Never inject into admin paths.
  const url = new URL(req.url);
  if (url.pathname.startsWith(adminPrefix)) return response;

  // Cheap pre-check before the (storage-backed) session lookup.
  if (!hasAdminSessionCookie(req)) return response;

  let authResult: Awaited<ReturnType<AuthMiddleware["authenticate"]>>;
  try {
    authResult = await auth.authenticate(req);
  } catch {
    return response;
  }
  if (!authResult.authenticated || !authResult.user) return response;
  if (!auth.hasPermission(authResult, "pages.update")) return response;

  // Find the content page for this URL.
  const page = engine.pages.find((p) => p.route === url.pathname);
  if (!page?.sourcePath) return response;

  const { sourcePath } = page;
  const barHtml = buildAdminBarHtml({
    sourcePath,
    pageTitle: page.title ?? page.route,
    adminPrefix,
    userName: authResult.user.username,
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
