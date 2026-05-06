/** @jsxImportSource preact */
/**
 * Island: site configuration editor — tabbed form for site settings,
 * theme switcher with preview, and theme config editor.
 * Talks to /admin/api/config, /admin/api/config/themes, /admin/api/config/theme,
 * and /admin/api/config/theme-config.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface SiteConfig {
  title: string;
  description: string;
  url: string;
  author: { name: string; email: string };
  metadata: Record<string, string>;
  taxonomies: string[];
}

interface ThemeInfo {
  available: string[];
  current: string;
}

type Tab = "site" | "theme" | "theme-config";

interface Props {
  prefix: string;
}

export default function ConfigEditor({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [tab, setTab] = useState<Tab>("site");
  const [loading, setLoading] = useState(true);

  // Site config
  const [config, setConfig] = useState<SiteConfig>({
    title: "", description: "", url: "",
    author: { name: "", email: "" }, metadata: {}, taxonomies: [],
  });
  const [savingSite, setSavingSite] = useState(false);
  const [siteSaved, setSiteSaved] = useState(false);

  // Theme
  const [themes, setThemes] = useState<ThemeInfo>({ available: [], current: "" });
  const [selectedTheme, setSelectedTheme] = useState("");
  const [switchingTheme, setSwitchingTheme] = useState(false);
  const [themeMsg, setThemeMsg] = useState("");

  // Theme config
  const [themeConfigSchema, setThemeConfigSchema] = useState<Record<string, { type: string; label: string; default?: unknown }>>({});
  const [themeConfig, setThemeConfig] = useState<Record<string, unknown>>({});
  const [savingThemeConfig, setSavingThemeConfig] = useState(false);
  const [themeConfigSaved, setThemeConfigSaved] = useState(false);

  const [error, setError] = useState("");
  const [taxInput, setTaxInput] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/config`).then((r) => r.json()),
      fetch(`${apiBase}/config/themes`).then((r) => r.json()),
      fetch(`${apiBase}/config/theme-config`).then((r) => r.json()),
    ])
      .then(([cfg, thm, tc]: [SiteConfig, ThemeInfo, { schema: Record<string, unknown>; config: Record<string, unknown> }]) => {
        setConfig(cfg);
        setThemes(thm);
        setSelectedTheme(thm.current);
        setThemeConfigSchema(tc.schema as Record<string, { type: string; label: string; default?: unknown }> ?? {});
        setThemeConfig(tc.config ?? {});
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function saveSiteConfig(e: Event) {
    e.preventDefault();
    setSavingSite(true);
    setSiteSaved(false);
    setError("");
    try {
      const res = await fetch(`${apiBase}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setSiteSaved(true);
      setTimeout(() => setSiteSaved(false), 3000);
    } finally {
      setSavingSite(false);
    }
  }

  async function switchTheme() {
    if (!selectedTheme || selectedTheme === themes.current) return;
    setSwitchingTheme(true);
    setThemeMsg("");
    try {
      const res = await fetch(`${apiBase}/config/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ theme: selectedTheme }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setThemeMsg((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setThemes((prev) => ({ ...prev, current: selectedTheme }));
      setThemeMsg(`Theme switched to "${selectedTheme}". Changes take effect on next page load.`);
    } finally {
      setSwitchingTheme(false);
    }
  }

  async function saveThemeConfig(e: Event) {
    e.preventDefault();
    setSavingThemeConfig(true);
    setThemeConfigSaved(false);
    try {
      await fetch(`${apiBase}/config/theme-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify(themeConfig),
      });
      setThemeConfigSaved(true);
      setTimeout(() => setThemeConfigSaved(false), 3000);
    } finally {
      setSavingThemeConfig(false);
    }
  }

  function addTaxonomy() {
    const t = taxInput.trim();
    if (!t || config.taxonomies.includes(t)) return;
    setConfig((prev) => ({ ...prev, taxonomies: [...prev.taxonomies, t] }));
    setTaxInput("");
  }

  function removeTaxonomy(t: string) {
    setConfig((prev) => ({ ...prev, taxonomies: prev.taxonomies.filter((x) => x !== t) }));
  }

  if (loading) return <div style="padding:2rem;color:#718096">Loading configuration…</div>;

  return (
    <div class="cfg-wrap">
      {error && <div class="alert alert-error" style="margin-bottom:1rem">{error}</div>}

      {/* Tabs */}
      <div class="cfg-tabs" style="display:flex;gap:0.5rem;border-bottom:1px solid #e2e8f0;margin-bottom:1.5rem">
        {(["site", "theme", "theme-config"] as Tab[]).map((t) => (
          <button
            key={t}
            class={`cfg-tab btn btn-sm${tab === t ? " btn-primary" : " btn-outline"}`}
            onClick={() => setTab(t)}
          >
            {t === "site" ? "Site" : t === "theme" ? "Theme" : "Theme Config"}
          </button>
        ))}
      </div>

      {/* Site tab */}
      {tab === "site" && (
        <form onSubmit={saveSiteConfig}>
          <div class="cfg-section">
            <h4>Site</h4>
            <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={config.title}
                  onInput={(e) => setConfig((c) => ({ ...c, title: (e.target as HTMLInputElement).value }))}
                />
              </div>
              <div class="form-group">
                <label>URL</label>
                <input
                  type="url"
                  value={config.url}
                  onInput={(e) => setConfig((c) => ({ ...c, url: (e.target as HTMLInputElement).value }))}
                />
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea
                rows={3}
                value={config.description}
                onInput={(e) => setConfig((c) => ({ ...c, description: (e.target as HTMLTextAreaElement).value }))}
              />
            </div>
          </div>

          <div class="cfg-section">
            <h4>Author</h4>
            <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={config.author.name}
                  onInput={(e) => setConfig((c) => ({ ...c, author: { ...c.author, name: (e.target as HTMLInputElement).value } }))}
                />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={config.author.email}
                  onInput={(e) => setConfig((c) => ({ ...c, author: { ...c.author, email: (e.target as HTMLInputElement).value } }))}
                />
              </div>
            </div>
          </div>

          <div class="cfg-section">
            <h4>Taxonomies</h4>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
              {config.taxonomies.map((t) => (
                <span key={t} class="badge" style="display:flex;align-items:center;gap:0.25rem">
                  {t}
                  <button type="button" style="border:none;background:none;cursor:pointer;padding:0;line-height:1" onClick={() => removeTaxonomy(t)}>×</button>
                </span>
              ))}
            </div>
            <div style="display:flex;gap:0.5rem">
              <input
                type="text"
                value={taxInput}
                onInput={(e) => setTaxInput((e.target as HTMLInputElement).value)}
                placeholder="Add taxonomy (e.g. tags)"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTaxonomy(); } }}
                style="flex:1"
              />
              <button type="button" class="btn btn-sm btn-outline" onClick={addTaxonomy}>Add</button>
            </div>
          </div>

          <div class="form-actions" style="margin-top:1.5rem">
            {siteSaved && <span style="color:#276749;margin-right:1rem">✓ Saved</span>}
            <button type="submit" class="btn btn-primary" disabled={savingSite}>
              {savingSite ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}

      {/* Theme tab */}
      {tab === "theme" && (
        <div>
          <div class="form-group">
            <label>Active theme</label>
            <select
              value={selectedTheme}
              onChange={(e) => setSelectedTheme((e.target as HTMLSelectElement).value)}
              style="max-width:300px"
            >
              {themes.available.map((t) => (
                <option key={t} value={t}>{t}{t === themes.current ? " (active)" : ""}</option>
              ))}
            </select>
          </div>
          {themeMsg && <div class="alert alert-success" style="margin-bottom:1rem">{themeMsg}</div>}
          <div class="form-actions">
            <button
              class="btn btn-primary"
              onClick={switchTheme}
              disabled={switchingTheme || selectedTheme === themes.current}
            >
              {switchingTheme ? "Switching…" : "Apply theme"}
            </button>
          </div>
          <div style="margin-top:2rem">
            <h4>Available themes</h4>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
              {themes.available.map((t) => (
                <div
                  key={t}
                  class={`theme-card${t === themes.current ? " theme-card-active" : ""}`}
                  style="border:1px solid #e2e8f0;border-radius:6px;padding:1rem;cursor:pointer;min-width:140px"
                  onClick={() => setSelectedTheme(t)}
                >
                  <div style="font-weight:600">{t}</div>
                  {t === themes.current && <span class="badge" style="margin-top:0.25rem">active</span>}
                </div>
              ))}
            </div>
          </div>
          <div style="margin-top:2rem">
            <a href={`${prefix}/marketplace?tab=themes`} class="btn btn-outline btn-sm">
              Browse more themes →
            </a>
          </div>
        </div>
      )}

      {/* Theme config tab */}
      {tab === "theme-config" && (
        <form onSubmit={saveThemeConfig}>
          {Object.keys(themeConfigSchema).length === 0 ? (
            <p style="color:#718096">This theme has no configurable options.</p>
          ) : (
            Object.entries(themeConfigSchema).map(([key, field]) => (
              <div class="form-group" key={key}>
                <label>{field.label}</label>
                {field.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={String(themeConfig[key] ?? field.default ?? "")}
                    onInput={(e) => setThemeConfig((c) => ({ ...c, [key]: (e.target as HTMLTextAreaElement).value }))}
                  />
                ) : field.type === "checkbox" ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(themeConfig[key] ?? field.default)}
                      onChange={(e) => setThemeConfig((c) => ({ ...c, [key]: (e.target as HTMLInputElement).checked }))}
                    />
                  </label>
                ) : (
                  <input
                    type="text"
                    value={String(themeConfig[key] ?? field.default ?? "")}
                    onInput={(e) => setThemeConfig((c) => ({ ...c, [key]: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </div>
            ))
          )}
          <div class="form-actions" style="margin-top:1.5rem">
            {themeConfigSaved && <span style="color:#276749;margin-right:1rem">✓ Saved</span>}
            <button type="submit" class="btn btn-primary" disabled={savingThemeConfig}>
              {savingThemeConfig ? "Saving…" : "Save theme config"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
