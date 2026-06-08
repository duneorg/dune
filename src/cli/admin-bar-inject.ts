/**
 * Admin bar injection — post-processes HTML responses to inject the admin
 * toolbar and edit-mode globals when an admin session is active.
 *
 * Works the same way as injectLiveReload / injectRtlDir: takes a Response,
 * returns a modified Response with HTML injected before `</body>`.
 *
 * No Preact islands are used here — the bar is rendered as static HTML with
 * a small inline script for interactivity.  This keeps the implementation
 * zero-dependency for the public page path.
 */

import type { SessionManager } from "../admin/auth/sessions.ts";
import type { DuneEngine } from "../core/engine.ts";

// ── Session cookie helpers ────────────────────────────────────────────────────

function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)dune_session=([^;]+)/);
  return match ? match[1] : null;
}

// ── HTML generation ───────────────────────────────────────────────────────────

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
  #dune-admin-bar .dune-ab-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; max-width: 320px; }
  #dune-admin-bar button { border: none; border-radius: 4px; padding: 3px 12px; font-size: 12px; cursor: pointer; }
  #dune-ab-edit-toggle { background: #3498db; color: #fff; }
  #dune-ab-save { background: #27ae60; color: #fff; }
  #dune-ab-save:disabled { opacity: .6; cursor: default; }
  #dune-admin-bar .dune-ab-escape { color: rgba(255,255,255,.55); text-decoration: none; font-size: 12px; margin-left: auto; }
  #dune-admin-bar .dune-ab-user { font-size: 11px; opacity: .5; }
  body { padding-top: 40px !important; }
  .dune-editable-text:hover .dune-edit-handle,
  .dune-editable-markdown:hover .dune-edit-handle--body { opacity: 1 !important; }
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
  window.__DUNE_EDIT_MODE__ = true;
  window.__DUNE_EDIT_SOURCE_PATH__ = ${JSON.stringify(sourcePath)};
  window.__DUNE_COMMIT_URL__ = ${JSON.stringify(commitUrl)};

  var editMode = true;
  var saveBtn = document.getElementById('dune-ab-save');
  var toggleBtn = document.getElementById('dune-ab-edit-toggle');

  toggleBtn.addEventListener('click', function() {
    editMode = !editMode;
    window.__DUNE_EDIT_MODE__ = editMode;
    toggleBtn.textContent = editMode ? '✎ Editing' : '👁 Preview';
    toggleBtn.style.background = editMode ? '#3498db' : 'rgba(255,255,255,.15)';
    toggleBtn.style.border = editMode ? 'none' : '1px solid rgba(255,255,255,.2)';
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
})();
</script>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Public helper ─────────────────────────────────────────────────────────────

/**
 * Check if the request carries a valid admin session; if so, inject the
 * admin bar HTML before `</body>` in the response.
 *
 * Returns the original response unchanged when:
 * - The response is not HTML
 * - No admin session cookie is present
 * - The session is expired or invalid
 * - The request is for an admin path (bar is never injected into admin UI itself)
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

  const html = buildAdminBarHtml({
    sourcePath: page.sourcePath,
    pageTitle: page.title ?? page.route,
    adminPrefix,
    userName: session.userId,
  });

  return new Response(
    response.body
      ? response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk);
              const injected = text.includes("</body>")
                ? text.replace("</body>", `${html}</body>`)
                : text.includes("</html>")
                  ? text.replace("</html>", `${html}</html>`)
                  : text + html;
              controller.enqueue(new TextEncoder().encode(injected));
            },
          }),
        )
      : null,
    {
      status: response.status,
      headers: new Headers(
        [...response.headers.entries()].filter(
          ([k]) => k.toLowerCase() !== "content-length",
        ),
      ),
    },
  );
}
