/**
 * Revision history — timeline and diff viewer for content versions.
 *
 * Renders as a page within the admin panel showing revision history
 * for a specific content page.
 */

import type { ContentRevision, ContentDiff } from "../../workflow/types.ts";

interface RevisionHistoryData {
  sourcePath: string;
  revisions: ContentRevision[];
  currentContent: string;
}

/**
 * Render the revision history page content.
 */
export function renderRevisionHistory(prefix: string, data: RevisionHistoryData): string {
  const timelineItems = data.revisions.map((rev, i) => {
    const date = new Date(rev.createdAt);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const isLatest = i === 0;

    return `
    <div class="revision-item ${isLatest ? "revision-latest" : ""}" data-rev="${rev.number}">
      <div class="revision-marker">
        <div class="revision-dot ${isLatest ? "dot-latest" : ""}"></div>
        ${i < data.revisions.length - 1 ? '<div class="revision-line"></div>' : ""}
      </div>
      <div class="revision-content">
        <div class="revision-header">
          <span class="revision-number">#${rev.number}</span>
          ${isLatest ? '<span class="badge badge-latest">Latest</span>' : ""}
          <span class="revision-date">${dateStr} ${timeStr}</span>
        </div>
        ${rev.message ? `<div class="revision-message">${escapeHtml(rev.message)}</div>` : ""}
        <div class="revision-meta">
          ${rev.author ? `<span class="revision-author">by ${escapeHtml(rev.author)}</span>` : ""}
        </div>
        <div class="revision-actions">
          <button class="btn btn-xs btn-outline" onclick="viewRevision('${data.sourcePath}', ${rev.number})">View</button>
          <button class="btn btn-xs btn-outline" onclick="diffRevision('${data.sourcePath}', ${rev.number})">Diff</button>
          ${!isLatest ? `<button class="btn btn-xs btn-outline" onclick="restoreRevision('${data.sourcePath}', ${rev.number})">Restore</button>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  return `
  <div class="revision-history">
    <div class="revision-toolbar">
      <h3>Revision History</h3>
      <span class="revision-count">${data.revisions.length} revision${data.revisions.length !== 1 ? "s" : ""}</span>
    </div>

    <div class="revision-layout">
      <div class="revision-timeline">
        ${data.revisions.length > 0 ? timelineItems : '<p class="revision-empty">No revisions recorded yet.</p>'}
      </div>

      <div class="revision-detail" id="revision-detail">
        <div class="revision-detail-empty">
          <p>Select a revision to view its content or diff.</p>
        </div>
      </div>
    </div>
  </div>
  `;
}

/**
 * Render inline scripts for revision history interactions.
 */
export function renderRevisionScripts(prefix: string): string {
  return `
  <script>
    async function viewRevision(sourcePath, revNum) {
      const detail = document.getElementById('revision-detail');
      detail.innerHTML = '<p>Loading...</p>';

      try {
        const res = await fetch(\`${prefix}/api/history/\${encodeURIComponent(sourcePath)}/\${revNum}\`);
        const rev = await res.json();

        if (rev.error) {
          detail.innerHTML = '<p class="error">Error: ' + rev.error + '</p>';
          return;
        }

        detail.innerHTML = \`
          <div class="revision-view">
            <div class="revision-view-header">
              <h4>Revision #\${rev.number}</h4>
              <span class="revision-date">\${new Date(rev.createdAt).toLocaleString()}</span>
            </div>
            \${rev.message ? '<div class="revision-message">' + escapeHtml(rev.message) + '</div>' : ''}
            <div class="revision-view-content">
              <pre><code>\${escapeHtml(rev.content)}</code></pre>
            </div>
          </div>
        \`;
      } catch (err) {
        detail.innerHTML = '<p class="error">Failed to load revision: ' + err.message + '</p>';
      }
    }

    async function diffRevision(sourcePath, revNum) {
      const detail = document.getElementById('revision-detail');
      detail.innerHTML = '<p>Computing diff...</p>';

      try {
        const res = await fetch(\`${prefix}/api/history/\${encodeURIComponent(sourcePath)}/\${revNum}/diff\`);
        const diff = await res.json();

        if (diff.error) {
          detail.innerHTML = '<p class="error">Error: ' + diff.error + '</p>';
          return;
        }

        const diffHtml = renderDiffPatch(diff.patch);
        detail.innerHTML = \`
          <div class="revision-diff">
            <div class="revision-view-header">
              <h4>Diff: Revision #\${revNum} → Current</h4>
              <span class="diff-stats">
                <span class="diff-add">+\${diff.additions}</span>
                <span class="diff-del">-\${diff.deletions}</span>
              </span>
            </div>
            <div class="diff-content">
              \${diffHtml}
            </div>
          </div>
        \`;
      } catch (err) {
        detail.innerHTML = '<p class="error">Failed to compute diff: ' + err.message + '</p>';
      }
    }

    async function restoreRevision(sourcePath, revNum) {
      if (!confirm('Restore revision #' + revNum + '? This will overwrite the current content.')) return;

      try {
        const res = await fetch(\`${prefix}/api/history/\${encodeURIComponent(sourcePath)}/\${revNum}/restore\`, {
          method: 'POST'
        });
        const data = await res.json();

        if (data.error) {
          alert('Error: ' + data.error);
        } else {
          alert('Revision #' + revNum + ' restored successfully.');
          location.reload();
        }
      } catch (err) {
        alert('Failed to restore: ' + err.message);
      }
    }

    function renderDiffPatch(patch) {
      if (!patch) return '<p class="diff-empty">No differences.</p>';

      return patch.split('\\n').map(function(line) {
        if (line.startsWith('@@')) return '<div class="diff-hunk">' + escapeHtml(line) + '</div>';
        if (line.startsWith('+')) return '<div class="diff-line diff-add-line">' + escapeHtml(line) + '</div>';
        if (line.startsWith('-')) return '<div class="diff-line diff-del-line">' + escapeHtml(line) + '</div>';
        return '<div class="diff-line">' + escapeHtml(line) + '</div>';
      }).join('');
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
  `;
}

/**
 * CSS for revision history.
 */
export function revisionHistoryStyles(): string {
  return `
  .revision-history { }
  .revision-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .revision-toolbar h3 { margin: 0; }
  .revision-count { color: #6b7280; font-size: 0.85rem; }
  .revision-layout { display: grid; grid-template-columns: 340px 1fr; gap: 1.5rem; }
  .revision-timeline { }
  .revision-item { display: flex; gap: 0.75rem; }
  .revision-marker { display: flex; flex-direction: column; align-items: center; }
  .revision-dot { width: 10px; height: 10px; border-radius: 50%; background: #d1d5db; flex-shrink: 0; margin-top: 4px; }
  .dot-latest { background: #10b981; }
  .revision-line { width: 2px; flex: 1; background: #e5e7eb; margin: 2px 0; }
  .revision-content { flex: 1; padding-bottom: 1rem; }
  .revision-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem; }
  .revision-number { font-weight: 600; font-size: 0.85rem; color: #374151; }
  .badge-latest { background: #d1fae5; color: #065f46; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; }
  .revision-date { color: #9ca3af; font-size: 0.75rem; }
  .revision-message { font-size: 0.85rem; color: #4b5563; margin-bottom: 0.2rem; }
  .revision-meta { font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.35rem; }
  .revision-actions { display: flex; gap: 0.25rem; }
  .revision-empty { color: #9ca3af; font-size: 0.85rem; padding: 1rem 0; }
  .revision-detail { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); padding: 1rem; min-height: 300px; }
  .revision-detail-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af; }
  .revision-view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #f3f4f6; }
  .revision-view-header h4 { margin: 0; font-size: 0.9rem; }
  .revision-view-content pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem; font-size: 0.8rem; overflow-x: auto; max-height: 500px; overflow-y: auto; }
  .diff-stats { display: flex; gap: 0.5rem; font-size: 0.8rem; font-weight: 600; }
  .diff-add { color: #10b981; }
  .diff-del { color: #ef4444; }
  .diff-content { font-family: monospace; font-size: 0.8rem; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; overflow-x: auto; }
  .diff-hunk { background: #eff6ff; color: #3b82f6; padding: 0.25rem 0.5rem; font-weight: 600; }
  .diff-line { padding: 0.1rem 0.5rem; white-space: pre; }
  .diff-add-line { background: #d1fae5; color: #065f46; }
  .diff-del-line { background: #fee2e2; color: #991b1b; }
  .diff-empty { color: #9ca3af; padding: 1rem; text-align: center; }
  .error { color: #ef4444; }
  .revision-latest { }
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
