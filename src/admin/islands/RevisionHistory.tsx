/** @jsxImportSource preact */
/**
 * Island: revision history timeline with diff viewer and restore action.
 * Uses /admin/api/history/[...rest] catch-all endpoint.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface Revision {
  number: number;
  message?: string;
  author?: string;
  createdAt: number;
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  lineNo?: number;
}

interface Props {
  pagePath: string;
  prefix: string;
}

export default function RevisionHistory({ pagePath, prefix }: Props) {
  const apiBase = `${prefix}/api`;
  const encoded = encodeURIComponent(pagePath);

  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState("");

  // Viewer state
  const [viewRev, setViewRev] = useState<{ number: number; content: string } | null>(null);
  const [diffRev, setDiffRev] = useState<{ number: number; lines: DiffLine[] } | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreMsg, setRestoreMsg] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/history/${encoded}`)
      .then((r) => r.json())
      .then((d: { revisions: Revision[] }) => setRevisions(d.revisions ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pagePath]);

  async function loadView(revNumber: number) {
    setDiffRev(null);
    const res = await fetch(`${apiBase}/history/${encoded}/${revNumber}`);
    if (!res.ok) return;
    const d = await res.json() as { content: string };
    setViewRev({ number: revNumber, content: d.content });
  }

  async function loadDiff(revNumber: number) {
    setViewRev(null);
    const res = await fetch(`${apiBase}/history/${encoded}/${revNumber}/diff`);
    if (!res.ok) return;
    const d = await res.json() as { lines: DiffLine[] };
    setDiffRev({ number: revNumber, lines: d.lines ?? [] });
  }

  async function restore(revNumber: number) {
    if (!confirm(`Restore revision #${revNumber}? This will create a new revision.`)) return;
    setRestoring(revNumber);
    setRestoreMsg("");
    try {
      const res = await fetch(`${apiBase}/history/${encoded}/${revNumber}/restore`, {
        method: "POST",
        headers: { "X-CSRF-Token": getCsrf() },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setRestoreMsg((e as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setRestoreMsg(`Revision #${revNumber} restored successfully.`);
      // Reload list
      const updated = await fetch(`${apiBase}/history/${encoded}`).then((r) => r.json());
      setRevisions((updated as { revisions: Revision[] }).revisions ?? []);
      setViewRev(null);
      setDiffRev(null);
    } finally {
      setRestoring(null);
    }
  }

  if (loading) return <div style="padding:2rem;color:#718096">Loading history…</div>;
  if (error) return <div style="padding:2rem;color:#e53e3e">{error}</div>;

  return (
    <div class="revision-wrap" style="display:flex;gap:1.5rem;align-items:flex-start">
      {/* Timeline */}
      <div class="revision-timeline" style="width:320px;flex-shrink:0">
        {revisions.length === 0 ? (
          <p style="color:#718096">No revisions yet.</p>
        ) : (
          revisions.map((rev, idx) => {
            const date = new Date(rev.createdAt);
            const isLatest = idx === 0;
            return (
              <div
                key={rev.number}
                class={`revision-item${isLatest ? " revision-latest" : ""}`}
              >
                <div class="revision-header">
                  <span class="revision-number">#{rev.number}</span>
                  {isLatest && <span class="badge badge-latest">Latest</span>}
                  <span class="revision-date">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {rev.message && <div class="revision-message">{rev.message}</div>}
                {rev.author && <div class="revision-author">by {rev.author}</div>}
                <div class="revision-actions">
                  <button
                    class="btn btn-xs btn-outline"
                    onClick={() => loadView(rev.number)}
                  >
                    View
                  </button>
                  {!isLatest && (
                    <button
                      class="btn btn-xs btn-outline"
                      onClick={() => loadDiff(rev.number)}
                    >
                      Diff
                    </button>
                  )}
                  {!isLatest && (
                    <button
                      class="btn btn-xs btn-outline"
                      onClick={() => restore(rev.number)}
                      disabled={restoring === rev.number}
                    >
                      {restoring === rev.number ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Content panel */}
      <div class="revision-content-panel" style="flex:1;min-width:0">
        {restoreMsg && (
          <div class="alert alert-success" style="margin-bottom:1rem">{restoreMsg}</div>
        )}

        {viewRev && (
          <div>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
              <h4 style="margin:0">Revision #{viewRev.number}</h4>
              <button class="btn btn-xs btn-outline" onClick={() => setViewRev(null)}>Close</button>
            </div>
            <pre
              style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1rem;overflow:auto;font-size:0.85rem;max-height:60vh"
            >{viewRev.content}</pre>
          </div>
        )}

        {diffRev && (
          <div>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
              <h4 style="margin:0">Diff for revision #{diffRev.number}</h4>
              <button class="btn btn-xs btn-outline" onClick={() => setDiffRev(null)}>Close</button>
            </div>
            <pre
              style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1rem;overflow:auto;font-size:0.85rem;max-height:60vh"
            >
              {diffRev.lines.map((line, i) => (
                <span
                  key={i}
                  style={
                    line.type === "add"
                      ? "color:#276749;background:#f0fff4;display:block"
                      : line.type === "remove"
                      ? "color:#9b2c2c;background:#fff5f5;display:block"
                      : "display:block"
                  }
                >
                  {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                  {line.content}
                </span>
              ))}
            </pre>
          </div>
        )}

        {!viewRev && !diffRev && (
          <div style="color:#718096;padding:2rem 0">
            Select View or Diff on any revision to inspect it.
          </div>
        )}
      </div>
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
