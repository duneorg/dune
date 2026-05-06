/** @jsxImportSource preact */
/**
 * Island: translation memory browser — view, add, delete TM entries per language pair,
 * and trigger a TM rebuild from existing page translations.
 * Talks to /admin/api/i18n/memory.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface TMEntry {
  source: string;
  target: string;
}

interface Props {
  prefix: string;
  supportedLanguages: string[];
}

export default function TranslationMemory({ prefix, supportedLanguages }: Props) {
  const apiBase = `${prefix}/api`;
  const defaultLang = supportedLanguages[0] ?? "en";
  const otherLangs = supportedLanguages.slice(1);

  const [from, setFrom] = useState(defaultLang);
  const [to, setTo] = useState(otherLangs[0] ?? "");
  const [entries, setEntries] = useState<TMEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (to) loadEntries();
  }, [from, to]);

  async function loadEntries() {
    if (!from || !to) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/i18n/memory?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const d = await res.json() as { entries: TMEntry[] };
      setEntries(d.entries ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addEntry(e: Event) {
    e.preventDefault();
    if (!newSource.trim() || !newTarget.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/i18n/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ from, to, source: newSource.trim(), target: newTarget.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setNewSource("");
      setNewTarget("");
      setShowAdd(false);
      await loadEntries();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(source: string) {
    if (!confirm("Delete this TM entry?")) return;
    await fetch(`${apiBase}/i18n/memory`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ from, to, source }),
    });
    await loadEntries();
  }

  async function rebuild() {
    if (!confirm("Rebuild TM from all existing translation pairs? This may take a moment.")) return;
    setRebuilding(true);
    setRebuildMsg("");
    try {
      const res = await fetch(`${apiBase}/i18n/memory/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ from, to }),
      });
      const d = await res.json() as { added: number };
      setRebuildMsg(`Done. ${d.added} new entries added.`);
      await loadEntries();
    } finally {
      setRebuilding(false);
    }
  }

  if (supportedLanguages.length < 2) {
    return (
      <div style="padding:2rem 0;color:#718096">
        Translation memory requires at least two configured languages.
      </div>
    );
  }

  return (
    <div>
      {/* Language pair selector */}
      <div class="tm-header" style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
        <div class="tm-tabs" style="display:flex;gap:0.5rem">
          {otherLangs.map((lang) => (
            <button
              key={lang}
              class={`btn btn-sm${lang === to ? " btn-primary" : " btn-outline"}`}
              onClick={() => setTo(lang)}
            >
              {from.toUpperCase()} → {lang.toUpperCase()}
            </button>
          ))}
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:0.75rem">
          <span style="color:#718096;font-size:0.9rem">{entries.length} entries</span>
          <button class="btn btn-sm btn-outline" onClick={() => { setShowAdd(true); setError(""); }}>
            + Add Entry
          </button>
          <button
            class="btn btn-sm btn-outline"
            onClick={rebuild}
            disabled={rebuilding}
          >
            {rebuilding ? "Rebuilding…" : "Rebuild from Translations"}
          </button>
        </div>
      </div>

      {rebuildMsg && <div class="alert alert-success" style="margin-bottom:1rem">{rebuildMsg}</div>}
      {error && <div class="alert alert-error" style="margin-bottom:1rem">{error}</div>}

      {/* Add entry form */}
      {showAdd && (
        <form
          onSubmit={addEntry}
          style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:1rem;margin-bottom:1rem"
        >
          <h4 style="margin:0 0 0.75rem">Add / Update Entry</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div class="form-group">
              <label>Source ({from})</label>
              <textarea
                rows={3}
                value={newSource}
                onInput={(e) => setNewSource((e.target as HTMLTextAreaElement).value)}
                placeholder="Source text…"
                required
                autoFocus
              />
            </div>
            <div class="form-group">
              <label>Target ({to})</label>
              <textarea
                rows={3}
                value={newTarget}
                onInput={(e) => setNewTarget((e.target as HTMLTextAreaElement).value)}
                placeholder="Translation…"
                required
              />
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm" disabled={saving}>{saving ? "Saving…" : "Save entry"}</button>
          </div>
        </form>
      )}

      {/* Entry table */}
      {loading ? (
        <p style="color:#718096">Loading entries…</p>
      ) : entries.length === 0 ? (
        <p style="color:#718096;padding:1rem 0">
          No entries yet — click <strong>Rebuild from Translations</strong> to populate from existing pages.
        </p>
      ) : (
        <table class="admin-table tm-table">
          <thead>
            <tr>
              <th>Source ({from})</th>
              <th>Target ({to})</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.source} class="tm-row">
                <td><pre style="margin:0;white-space:pre-wrap;font-size:0.85rem">{e.source}</pre></td>
                <td><pre style="margin:0;white-space:pre-wrap;font-size:0.85rem">{e.target}</pre></td>
                <td>
                  <button class="btn btn-xs btn-danger" onClick={() => deleteEntry(e.source)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
