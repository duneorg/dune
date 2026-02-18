/**
 * Admin UI — Submissions list and detail views.
 */

import type { Submission, SubmissionStatus } from "../submissions.ts";

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-CH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusBadge(status: SubmissionStatus): string {
  const map: Record<SubmissionStatus, string> = {
    new: '<span class="sub-badge sub-badge-new">New</span>',
    read: '<span class="sub-badge sub-badge-read">Read</span>',
    archived: '<span class="sub-badge sub-badge-archived">Archived</span>',
  };
  return map[status] ?? escapeHtml(status);
}

/**
 * Render the submissions list page for one form.
 */
export function renderSubmissionsList(
  prefix: string,
  form: string,
  submissions: Submission[],
  newCount: number,
): string {
  const rows = submissions.length === 0
    ? `<tr><td colspan="5" class="sub-empty">No submissions yet.</td></tr>`
    : submissions.map((s) => {
      const name = escapeHtml(s.fields.name ?? "—");
      const email = escapeHtml(s.fields.email ?? "—");
      const project = escapeHtml(s.fields.project_type ?? "—");
      return `
      <tr class="sub-row ${s.status === "new" ? "sub-row-new" : ""}">
        <td>${statusBadge(s.status)}</td>
        <td>${formatDate(s.receivedAt)}</td>
        <td>${name}</td>
        <td><a href="mailto:${email}">${email}</a></td>
        <td>${project}</td>
        <td class="sub-actions">
          <a href="${prefix}/submissions/${encodeURIComponent(form)}/${s.id}" class="btn btn-xs btn-outline">View</a>
        </td>
      </tr>`;
    }).join("");

  return `
  <div class="sub-toolbar">
    <h2>Submissions <span class="sub-form-name">${escapeHtml(form)}</span>
      ${newCount > 0 ? `<span class="sub-badge sub-badge-new">${newCount} new</span>` : ""}
    </h2>
  </div>
  <table class="admin-table">
    <thead>
      <tr>
        <th>Status</th>
        <th>Received</th>
        <th>Name</th>
        <th>Email</th>
        <th>Project type</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * Render a single submission detail view.
 */
export function renderSubmissionDetail(
  prefix: string,
  form: string,
  submission: Submission,
): string {
  const fieldRows = Object.entries(submission.fields)
    .filter(([k]) => k !== "form_language")
    .map(([key, val]) => `
    <tr>
      <th>${escapeHtml(key.replace(/_/g, " "))}</th>
      <td>${escapeHtml(val ?? "")}</td>
    </tr>`).join("");

  const metaRows = [
    submission.meta.ip ? `<tr><th>IP</th><td><code>${escapeHtml(submission.meta.ip)}</code></td></tr>` : "",
    submission.meta.language ? `<tr><th>Language</th><td>${escapeHtml(submission.meta.language)}</td></tr>` : "",
    submission.meta.userAgent ? `<tr><th>User-Agent</th><td><small>${escapeHtml(submission.meta.userAgent)}</small></td></tr>` : "",
  ].filter(Boolean).join("");

  return `
  <div class="sub-detail-header">
    <a href="${prefix}/submissions/${encodeURIComponent(form)}" class="btn btn-sm btn-outline">← Back</a>
    <h2>Submission <code>${escapeHtml(submission.id)}</code></h2>
    <div class="sub-detail-meta">
      ${statusBadge(submission.status)}
      <span class="sub-date">${formatDate(submission.receivedAt)}</span>
    </div>
  </div>

  <div class="sub-detail-grid">
    <div>
      <h3>Fields</h3>
      <table class="admin-table sub-fields-table">
        <tbody>${fieldRows}</tbody>
      </table>
    </div>
    ${metaRows ? `
    <div>
      <h3>Request metadata</h3>
      <table class="admin-table sub-fields-table">
        <tbody>${metaRows}</tbody>
      </table>
    </div>` : ""}
  </div>

  <div class="sub-detail-actions">
    <form method="POST" action="${prefix}/submissions/${encodeURIComponent(form)}/${submission.id}/status" style="display:inline">
      <input type="hidden" name="status" value="read">
      <button type="submit" class="btn btn-sm btn-outline" ${submission.status === "read" ? "disabled" : ""}>Mark read</button>
    </form>
    <form method="POST" action="${prefix}/submissions/${encodeURIComponent(form)}/${submission.id}/status" style="display:inline">
      <input type="hidden" name="status" value="archived">
      <button type="submit" class="btn btn-sm btn-outline" ${submission.status === "archived" ? "disabled" : ""}>Archive</button>
    </form>
    <form method="POST" action="${prefix}/submissions/${encodeURIComponent(form)}/${submission.id}/delete"
          style="display:inline" onsubmit="return confirm('Permanently delete this submission?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>`;
}

export function submissionStyles(): string {
  return `
  .sub-toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .sub-form-name { font-weight: 400; color: #888; font-size: 0.9em; margin-left: 0.25rem; }
  .sub-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .sub-badge-new { background: #fef3c7; color: #92400e; }
  .sub-badge-read { background: #e0f2fe; color: #0369a1; }
  .sub-badge-archived { background: #f3f4f6; color: #6b7280; }
  .sub-row-new td { font-weight: 500; }
  .sub-actions { white-space: nowrap; }
  .sub-empty { text-align: center; color: #999; padding: 2rem; }
  .btn-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .btn-danger:hover { background: #fca5a5; }
  .btn-xs { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
  .sub-detail-header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .sub-detail-header h2 { flex: 1; }
  .sub-detail-meta { display: flex; align-items: center; gap: 0.5rem; }
  .sub-date { color: #888; font-size: 0.85rem; }
  .sub-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
  @media (max-width: 700px) { .sub-detail-grid { grid-template-columns: 1fr; } }
  .sub-fields-table th { width: 140px; color: #555; font-weight: 600; vertical-align: top; }
  .sub-fields-table td { white-space: pre-wrap; word-break: break-word; }
  .sub-detail-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  h3 { margin-bottom: 0.75rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
  `;
}
