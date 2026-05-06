/** @jsxImportSource preact */
/**
 * Island: visual page builder with section palette, drag-and-drop canvas,
 * field editors per section, and page-settings sidebar.
 * Saves via PUT /admin/api/pages/:path (sections stored in frontmatter).
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

interface SectionField {
  type: string;
  label: string;
  default?: unknown;
  options?: Record<string, string>;
}

interface SectionDef {
  type: string;
  label: string;
  description?: string;
  fields: Record<string, SectionField>;
  preview?: string;
}

interface SectionInstance {
  type: string;
  id: string;
  [key: string]: unknown;
}

interface Props {
  pagePath: string;
  prefix: string;
}

export default function PageBuilder({ pagePath, prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [defs, setDefs] = useState<SectionDef[]>([]);
  const [sections, setSections] = useState<SectionInstance[]>([]);
  const [pageTitle, setPageTitle] = useState("");
  const [published, setPublished] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/pages/${encodeURIComponent(pagePath)}`).then((r) => r.json()),
      fetch(`${apiBase}/sections`).then((r) => r.json()),
    ])
      .then(([pageData, sectionsData]: [Record<string, unknown>, { sections: SectionDef[] }]) => {
        const fm = (pageData.frontmatter as Record<string, unknown>) ?? {};
        setPageTitle(String(fm.title ?? pageData.title ?? ""));
        setPublished(Boolean(fm.published));
        const raw = (fm.sections as SectionInstance[]) ?? [];
        setSections(raw.map((s, i) => ({ ...s, id: s.id ?? `sec-${i}` })));
        setDefs(sectionsData.sections ?? []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pagePath]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/pages/${encodeURIComponent(pagePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          frontmatter: { title: pageTitle, published, sections, layout: "page-builder" },
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError((e as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setDirty(false);
      refreshPreview();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function addSection(type: string) {
    const def = defs.find((d) => d.type === type);
    if (!def) return;
    const defaults: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(def.fields)) {
      defaults[k] = f.default ?? "";
    }
    const id = `sec-${Date.now()}`;
    setSections((prev) => [...prev, { type, id, ...defaults }]);
    setSelectedId(id);
    setDirty(true);
  }

  function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  }

  function moveSection(id: string, dir: -1 | 1) {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setDirty(true);
  }

  function updateField(id: string, key: string, value: unknown) {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [key]: value } : s))
    );
    setDirty(true);
  }

  function refreshPreview() {
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      });
    }
  }

  const selectedSection = sections.find((s) => s.id === selectedId) ?? null;
  const selectedDef = selectedSection ? defs.find((d) => d.type === selectedSection.type) : null;

  if (loading) return <div style="padding:2rem;color:#718096">Loading builder…</div>;

  return (
    <div class="bld-layout">
      {/* Toolbar */}
      <header class="bld-toolbar">
        <div class="bld-toolbar-left">
          <a href={`${prefix}/pages`} class="btn btn-sm btn-outline">← Pages</a>
          <a href={`${prefix}/pages/edit?path=${encodeURIComponent(pagePath)}`} class="btn btn-sm btn-outline">Classic Editor</a>
          <span class="bld-title">{pageTitle}</span>
        </div>
        <div class="bld-toolbar-right">
          <button class="btn btn-sm btn-outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide" : "Preview"}
          </button>
          {dirty && <span class="toolbar-dirty">Unsaved</span>}
          <button class="btn btn-sm btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div class="bld-body">
        {/* Section palette */}
        <aside class="bld-palette">
          <h4>Sections</h4>
          {defs.map((def) => (
            <button
              key={def.type}
              class="bld-palette-item"
              onClick={() => addSection(def.type)}
              title={def.description}
            >
              <span class="bld-palette-icon">+</span>
              <span>{def.label}</span>
            </button>
          ))}
          {defs.length === 0 && (
            <p style="color:#718096;font-size:0.85rem">No section types registered.</p>
          )}
        </aside>

        {/* Canvas */}
        <main class="bld-canvas">
          {sections.length === 0 ? (
            <div class="bld-canvas-empty">
              <p>No sections yet. Add sections from the palette on the left.</p>
            </div>
          ) : (
            sections.map((sec, idx) => {
              const def = defs.find((d) => d.type === sec.type);
              const isSelected = sec.id === selectedId;
              return (
                <div
                  key={sec.id}
                  class={`bld-section${isSelected ? " bld-section-selected" : ""}`}
                  onClick={() => setSelectedId(sec.id)}
                >
                  <div class="bld-section-header">
                    <span class="bld-section-type">{def?.label ?? sec.type}</span>
                    <div class="bld-section-controls">
                      <button
                        class="btn btn-xs btn-outline"
                        onClick={(e) => { e.stopPropagation(); moveSection(sec.id, -1); }}
                        disabled={idx === 0}
                        title="Move up"
                      >↑</button>
                      <button
                        class="btn btn-xs btn-outline"
                        onClick={(e) => { e.stopPropagation(); moveSection(sec.id, 1); }}
                        disabled={idx === sections.length - 1}
                        title="Move down"
                      >↓</button>
                      <button
                        class="btn btn-xs btn-danger"
                        onClick={(e) => { e.stopPropagation(); removeSection(sec.id); }}
                        title="Remove"
                      >×</button>
                    </div>
                  </div>
                  {isSelected && def && (
                    <div class="bld-section-preview">
                      {Object.entries(def.fields).slice(0, 2).map(([k, f]) => (
                        <span key={k} style="font-size:0.8rem;color:#718096;margin-right:0.5rem">
                          {f.label}: {String(sec[k] ?? "").slice(0, 40)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </main>

        {/* Field editor / page settings sidebar */}
        <aside class="bld-settings">
          {selectedSection && selectedDef ? (
            <>
              <h4>{selectedDef.label} settings</h4>
              {Object.entries(selectedDef.fields).map(([key, field]) => (
                <div class="form-group" key={key}>
                  <label>{field.label}</label>
                  {field.type === "textarea" ? (
                    <textarea
                      rows={4}
                      value={String(selectedSection[key] ?? field.default ?? "")}
                      onInput={(e) =>
                        updateField(selectedSection.id, key, (e.target as HTMLTextAreaElement).value)
                      }
                    />
                  ) : field.type === "select" && field.options ? (
                    <select
                      value={String(selectedSection[key] ?? field.default ?? "")}
                      onChange={(e) =>
                        updateField(selectedSection.id, key, (e.target as HTMLSelectElement).value)
                      }
                    >
                      {Object.entries(field.options).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedSection[key] ?? field.default)}
                        onChange={(e) =>
                          updateField(selectedSection.id, key, (e.target as HTMLInputElement).checked)
                        }
                      />
                    </label>
                  ) : (
                    <input
                      type="text"
                      value={String(selectedSection[key] ?? field.default ?? "")}
                      onInput={(e) =>
                        updateField(selectedSection.id, key, (e.target as HTMLInputElement).value)
                      }
                    />
                  )}
                </div>
              ))}
            </>
          ) : (
            <>
              <h4>Page settings</h4>
              <div class="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={pageTitle}
                  onInput={(e) => { setPageTitle((e.target as HTMLInputElement).value); setDirty(true); }}
                />
              </div>
              <div class="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => { setPublished((e.target as HTMLInputElement).checked); setDirty(true); }}
                  />{" "}
                  Published
                </label>
              </div>
              {showPreview && (
                <iframe
                  ref={iframeRef}
                  src={`${prefix}/api/preview`}
                  style="width:100%;height:300px;border:1px solid #e2e8f0;border-radius:4px;margin-top:1rem"
                  title="Preview"
                />
              )}
            </>
          )}
        </aside>
      </div>

      {error && (
        <div class="toast toast-error" style="position:fixed;bottom:1rem;right:1rem">
          {error}
        </div>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
