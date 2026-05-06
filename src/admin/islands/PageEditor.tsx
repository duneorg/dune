/** @jsxImportSource preact */
/**
 * Island: full-page editor with frontmatter sidebar, content area, and live preview.
 * Fetches page data from /admin/api/pages/:path and saves back via PUT.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

interface BpField {
  type: string;
  label: string;
  default?: unknown;
  required?: boolean;
  options?: Record<string, string>;
}

interface PageData {
  route: string;
  title: string;
  format: string;
  template: string;
  published: boolean;
  rawContent: string | null;
  frontmatter: Record<string, unknown>;
  language?: string;
  translations?: Array<{ lang: string; sourcePath: string; exists: boolean }>;
  blueprint?: { title: string; fields: Record<string, BpField> } | null;
  revisionCount?: number;
}

interface Props {
  pagePath: string;
  pageIndex: unknown;
  prefix: string;
}

export default function PageEditor({ pagePath, prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageData | null>(null);
  const [rawContent, setRawContent] = useState("");
  const [fm, setFm] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch(`${apiBase}/pages/${encodeURIComponent(pagePath)}`)
      .then((r) => r.json())
      .then((data: PageData) => {
        setPage(data);
        setRawContent(data.rawContent ?? "");
        setFm(data.frontmatter ?? {});
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pagePath]);

  // Warn on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    globalThis.addEventListener("beforeunload", handler);
    return () => globalThis.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save() {
    if (!page) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/pages/${encodeURIComponent(pagePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          rawContent,
          frontmatter: { ...fm, title: fm.title ?? page.title },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
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

  function refreshPreview() {
    if (previewRef.current) {
      const src = previewRef.current.src;
      previewRef.current.src = "";
      requestAnimationFrame(() => {
        if (previewRef.current) previewRef.current.src = src;
      });
    }
  }

  function setFmField(key: string, value: unknown) {
    setFm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  if (loading) {
    return <div style="padding:2rem;color:#718096">Loading editor…</div>;
  }
  if (!page) {
    return <div style="padding:2rem;color:#e53e3e">{error || "Page not found."}</div>;
  }

  return (
    <div class="editor-layout">
      {/* Top toolbar */}
      <header class="editor-toolbar">
        <div class="toolbar-left">
          <a href={`${prefix}/pages`} class="btn btn-sm btn-outline">← Pages</a>
          <span class="editor-title">{String(fm.title ?? page.title)}</span>
          <span class={`badge badge-${page.format}`}>{page.format}</span>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-sm btn-outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <button class="btn btn-sm btn-outline" onClick={() => setSourceMode((v) => !v)}>
            {sourceMode ? "Visual" : "Source"}
          </button>
          <a
            href={`${prefix}/pages/builder?path=${encodeURIComponent(pagePath)}`}
            class="btn btn-sm btn-outline"
          >
            Builder
          </a>
          <a href={page.route} target="_blank" class="btn btn-sm btn-outline">View →</a>
          <a
            href={`${prefix}/pages/history?path=${encodeURIComponent(pagePath)}`}
            class="btn btn-sm btn-outline"
          >
            History{page.revisionCount ? ` (${page.revisionCount})` : ""}
          </a>
          {dirty && <span class="toolbar-dirty">Unsaved</span>}
          <button class="btn btn-sm btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div class="editor-body">
        {/* Frontmatter sidebar */}
        <aside class="editor-sidebar">
          <h4>Page Settings</h4>
          <div class="form-group">
            <label>Title</label>
            <input
              type="text"
              value={String(fm.title ?? "")}
              onInput={(e) => setFmField("title", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>Template</label>
            <input
              type="text"
              value={String(fm.template ?? page.template ?? "default")}
              onInput={(e) => setFmField("template", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>Slug</label>
            <input
              type="text"
              value={String(fm.slug ?? "")}
              placeholder="auto"
              onInput={(e) => setFmField("slug", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>
              <input
                type="checkbox"
                checked={!!fm.published}
                onChange={(e) => setFmField("published", (e.target as HTMLInputElement).checked)}
              />{" "}
              Published
            </label>
          </div>
          <div class="form-group">
            <label>Date</label>
            <input
              type="date"
              value={String(fm.date ?? "")}
              onInput={(e) => setFmField("date", (e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Blueprint extra fields */}
          {page.blueprint && Object.entries(page.blueprint.fields).map(([key, field]) => (
            <div class="form-group" key={key}>
              <label>{field.label}</label>
              {field.type === "text" || field.type === "string" ? (
                <input
                  type="text"
                  value={String(fm[key] ?? field.default ?? "")}
                  onInput={(e) => setFmField(key, (e.target as HTMLInputElement).value)}
                />
              ) : field.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={String(fm[key] ?? field.default ?? "")}
                  onInput={(e) => setFmField(key, (e.target as HTMLTextAreaElement).value)}
                />
              ) : field.type === "checkbox" || field.type === "bool" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(fm[key] ?? field.default)}
                    onChange={(e) => setFmField(key, (e.target as HTMLInputElement).checked)}
                  />
                </label>
              ) : field.type === "select" && field.options ? (
                <select
                  value={String(fm[key] ?? field.default ?? "")}
                  onChange={(e) => setFmField(key, (e.target as HTMLSelectElement).value)}
                >
                  {Object.entries(field.options).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}

          {/* Translations */}
          {page.translations && page.translations.length > 0 && (
            <div class="form-group">
              <label>Translations</label>
              <div class="translation-links">
                {page.translations.map((t) => (
                  <div key={t.lang} class="translation-item">
                    <span class="badge badge-lang">{t.lang}</span>
                    {t.exists ? (
                      <a
                        href={`${prefix}/pages/edit?path=${encodeURIComponent(t.sourcePath)}`}
                        class="btn btn-xs btn-outline"
                      >
                        Edit
                      </a>
                    ) : (
                      <button
                        class="btn btn-xs btn-outline"
                        onClick={() => createTranslation(t.lang)}
                      >
                        Create
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Content area */}
        <main class={`editor-main${showPreview ? " editor-main-split" : ""}`}>
          <textarea
            class="editor-content"
            value={rawContent}
            onInput={(e) => {
              setRawContent((e.target as HTMLTextAreaElement).value);
              setDirty(true);
            }}
            style="width:100%;height:100%;font-family:monospace;font-size:14px;border:none;outline:none;resize:none;padding:1rem"
            spellcheck={false}
          />
        </main>

        {/* Preview panel */}
        {showPreview && (
          <aside class="editor-preview">
            <iframe
              ref={previewRef}
              src={`${prefix}/api/preview`}
              style="width:100%;height:100%;border:none"
              title="Page preview"
            />
          </aside>
        )}
      </div>

      {error && (
        <div class="toast toast-error" style="position:fixed;bottom:1rem;right:1rem">
          {error}
        </div>
      )}
    </div>
  );

  async function createTranslation(lang: string) {
    const res = await fetch(`${apiBase}/pages/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ path: pagePath, targetLang: lang }),
    });
    if (res.ok) {
      const { path: newPath } = await res.json() as { path: string };
      location.href = `${prefix}/pages/edit?path=${encodeURIComponent(newPath)}`;
    }
  }
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
