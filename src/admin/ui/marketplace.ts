/**
 * Plugin + Theme Marketplace admin UI.
 *
 * Renders /admin/marketplace — a unified discovery page for the plugin and
 * theme registries, with install functionality for both.
 */

import type { AuthResult } from "../types.ts";
import { safeUrl } from "../../security/urls.ts";

/** Allow only https: or protocol-relative URLs for marketplace image sources. */
function httpsImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginRegistryEntry {
  name: string;
  label: string;
  description: string;
  author: string;
  version: string;
  license?: string;
  jsr: string;
  tags?: string[];
  hooks?: string[];
  compatibleWith?: string;
  verified: boolean;
  downloads: number;
  repositoryUrl?: string;
  iconUrl?: string | null;
}

export interface PluginRegistry {
  version: number;
  updatedAt?: string;
  plugins: PluginRegistryEntry[];
}

export interface ThemeRegistryEntry {
  slug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  license?: string;
  tags?: string[];
  demoUrl?: string;
  screenshotUrl?: string;
  downloadUrl: string;
  verified: boolean;
  downloads: number;
  compatibleWith?: string;
}

export interface ThemeRegistry {
  version: number;
  updatedAt?: string;
  themes: ThemeRegistryEntry[];
}

// ─── Public render function ───────────────────────────────────────────────────

/**
 * Render the full marketplace page.
 *
 * @param prefix          Admin route prefix (e.g. "/admin")
 * @param pluginRegistry  Bundled plugin registry
 * @param themeRegistry   Bundled theme registry
 * @param installedPlugins JSR names of currently installed plugins
 * @param installedThemes  Slugs of currently installed themes
 * @param auth            Authenticated user
 * @param activeTab       "plugins" | "themes" (default "plugins")
 */
export function renderMarketplacePage(
  prefix: string,
  pluginRegistry: PluginRegistry,
  themeRegistry: ThemeRegistry,
  installedPlugins: Set<string>,
  installedThemes: Set<string>,
  auth: AuthResult,
  activeTab: "plugins" | "themes" = "plugins",
): string {
  const userName = auth.user?.name ?? "Admin";

  const pluginCards = pluginRegistry.plugins.length === 0
    ? `<p class="mkt-empty">No plugins in registry.</p>`
    : pluginRegistry.plugins
      .map((p) => renderPluginCard(p, installedPlugins.has(p.name)))
      .join("\n");

  const themeCards = themeRegistry.themes.length === 0
    ? `<p class="mkt-empty">No themes in registry.</p>`
    : themeRegistry.themes
      .map((t) => renderThemeCard(prefix, t, installedThemes.has(t.slug)))
      .join("\n");

  const pluginMeta = `${pluginRegistry.plugins.length} plugin${pluginRegistry.plugins.length !== 1 ? "s" : ""}${pluginRegistry.updatedAt ? ` · updated ${escHtml(pluginRegistry.updatedAt)}` : ""}`;
  const themeMeta = `${themeRegistry.themes.length} theme${themeRegistry.themes.length !== 1 ? "s" : ""}${themeRegistry.updatedAt ? ` · updated ${escHtml(themeRegistry.updatedAt)}` : ""}`;

  const content = `
    <div class="mkt-header">
      <h2>Marketplace</h2>
      <p class="mkt-subtitle">Discover and install plugins and themes for your Dune site.</p>
    </div>

    <div class="mkt-tabs" role="tablist">
      <button class="mkt-tab${activeTab === "plugins" ? " active" : ""}"
        role="tab" aria-selected="${activeTab === "plugins"}"
        onclick="switchTab('plugins')">
        Plugins
        <span class="mkt-tab-count">${pluginRegistry.plugins.length}</span>
      </button>
      <button class="mkt-tab${activeTab === "themes" ? " active" : ""}"
        role="tab" aria-selected="${activeTab === "themes"}"
        onclick="switchTab('themes')">
        Themes
        <span class="mkt-tab-count">${themeRegistry.themes.length}</span>
      </button>
    </div>

    <div id="tab-plugins" class="mkt-tab-panel${activeTab === "plugins" ? "" : " hidden"}" role="tabpanel">
      <p class="mkt-panel-meta">${pluginMeta}</p>
      <div class="mkt-plugin-list">${pluginCards}</div>
    </div>

    <div id="tab-themes" class="mkt-tab-panel${activeTab === "themes" ? "" : " hidden"}" role="tabpanel">
      <p class="mkt-panel-meta">${themeMeta}</p>
      <div class="mkt-themes-grid">${themeCards}</div>
    </div>

    <div id="mkt-toast" class="mkt-toast" style="display:none"></div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Marketplace — Dune Admin</title>
  <style>${marketplaceStyles()}</style>
</head>
<body>
  ${adminShellPartial(prefix, "marketplace", userName, content)}
  <script>${marketplaceScript(prefix)}</script>
</body>
</html>`;
}

// ─── Plugin card ──────────────────────────────────────────────────────────────

function renderPluginCard(entry: PluginRegistryEntry, isInstalled: boolean): string {
  const safeIconUrl = httpsImageSrc(entry.iconUrl);
  const icon = safeIconUrl
    ? `<img src="${escAttr(safeIconUrl)}" alt="" class="plugin-icon" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : "";
  const iconFallback = `<span class="plugin-icon-fallback" ${safeIconUrl ? 'style="display:none"' : ""}>🔌</span>`;

  const tags = (entry.tags ?? [])
    .map((t) => `<span class="mkt-tag">${escHtml(t)}</span>`)
    .join("");

  const hooks = (entry.hooks ?? [])
    .map((h) => `<span class="hook-badge">${escHtml(h)}</span>`)
    .join("");

  const verifiedBadge = entry.verified
    ? `<span class="mkt-badge mkt-badge--verified" title="Verified publisher">✓ Verified</span>`
    : "";

  const installBtn = isInstalled
    ? `<span class="btn btn-sm btn-disabled">Installed ✓</span>`
    : `<button class="btn btn-sm btn-primary" id="install-plugin-${escAttr(entry.name)}"
         onclick="installPlugin(${JSON.stringify(entry.name)}, ${JSON.stringify(entry.jsr)})">
         Install
       </button>`;

  return `
  <div class="plugin-card">
    <div class="plugin-card-left">
      <div class="plugin-icon-wrap">${icon}${iconFallback}</div>
    </div>
    <div class="plugin-card-body">
      <div class="plugin-card-top">
        <div class="plugin-meta">
          <span class="plugin-name">${escHtml(entry.label)}</span>
          <code class="plugin-pkg">${escHtml(entry.name)}</code>
          <span class="plugin-version">v${escHtml(entry.version)}</span>
          ${verifiedBadge}
          ${isInstalled ? `<span class="mkt-badge mkt-badge--installed">Installed</span>` : ""}
        </div>
        <div class="plugin-downloads" title="Total downloads">
          ↓ ${formatCount(entry.downloads)}
        </div>
      </div>
      <p class="plugin-description">${escHtml(entry.description)}</p>
      ${tags ? `<div class="mkt-tags">${tags}</div>` : ""}
      ${hooks ? `<div class="plugin-hooks"><span class="hooks-label">Hooks:</span>${hooks}</div>` : ""}
      <div class="plugin-card-footer">
        <div class="plugin-card-actions">
          ${entry.repositoryUrl
      ? `<a href="${escAttr(safeUrl(entry.repositoryUrl))}" target="_blank" rel="noopener noreferrer"
               class="btn btn-sm">Source ↗</a>`
      : ""}
          ${installBtn}
        </div>
        ${entry.compatibleWith
      ? `<span class="compat-label">Dune ${escHtml(entry.compatibleWith)}</span>`
      : ""}
      </div>
    </div>
  </div>`;
}

// ─── Theme card ───────────────────────────────────────────────────────────────

function renderThemeCard(
  prefix: string,
  entry: ThemeRegistryEntry,
  isInstalled: boolean,
): string {
  const safeScreenshotUrl = httpsImageSrc(entry.screenshotUrl);
  const screenshot = safeScreenshotUrl
    ? `<img src="${escAttr(safeScreenshotUrl)}" alt="${escAttr(entry.name)} screenshot"
         loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : "";
  const placeholder = `<span class="theme-placeholder-icon" ${safeScreenshotUrl ? 'style="display:none"' : ""}>🎨</span>`;

  const tags = (entry.tags ?? [])
    .map((t) => `<span class="mkt-tag">${escHtml(t)}</span>`)
    .join("");

  const verifiedBadge = entry.verified
    ? `<span class="mkt-badge mkt-badge--verified" title="Verified publisher">✓ Verified</span>`
    : "";

  return `
  <div class="theme-card">
    <div class="theme-card-screenshot">
      ${screenshot}${placeholder}
    </div>
    <div class="theme-card-body">
      <div class="theme-card-meta">
        <span class="theme-name">${escHtml(entry.name)}</span>
        <span class="theme-version">v${escHtml(entry.version)}</span>
        ${verifiedBadge}
        ${isInstalled ? `<span class="mkt-badge mkt-badge--installed">Installed</span>` : ""}
      </div>
      <p class="theme-author">by ${escHtml(entry.author)}${entry.license ? ` · ${escHtml(entry.license)}` : ""} · ↓ ${formatCount(entry.downloads)}</p>
      <p class="theme-description">${escHtml(entry.description)}</p>
      ${tags ? `<div class="mkt-tags">${tags}</div>` : ""}
      <div class="theme-card-actions">
        ${entry.demoUrl
      ? `<a href="${escAttr(safeUrl(entry.demoUrl))}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Demo ↗</a>`
      : ""}
        ${isInstalled
      ? `<span class="btn btn-sm btn-disabled">Installed ✓</span>`
      : `<button class="btn btn-sm btn-primary"
               id="install-theme-${escAttr(entry.slug)}"
               onclick="installTheme(${JSON.stringify(entry.slug)}, ${JSON.stringify(entry.downloadUrl)})">
             Install
           </button>`}
      </div>
      ${entry.compatibleWith ? `<p class="compat-label">Dune ${escHtml(entry.compatibleWith)}</p>` : ""}
    </div>
  </div>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── JavaScript ───────────────────────────────────────────────────────────────

function marketplaceScript(prefix: string): string {
  return `
function switchTab(tab) {
  document.querySelectorAll('.mkt-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.trim().toLowerCase().startsWith(tab));
    el.setAttribute('aria-selected', el.classList.contains('active') ? 'true' : 'false');
  });
  document.getElementById('tab-plugins').classList.toggle('hidden', tab !== 'plugins');
  document.getElementById('tab-themes').classList.toggle('hidden', tab !== 'themes');
  history.replaceState(null, '', location.pathname + '?tab=' + tab);
}

async function installPlugin(name, jsr) {
  const btn = document.getElementById('install-plugin-' + name);
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  try {
    const resp = await fetch('${prefix}/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, jsr }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Install failed');
    showToast('✓ Plugin "' + name + '" added to site.yaml. Restart the server to activate.', 'success');
    setTimeout(() => location.reload(), 2500);
  } catch (err) {
    showToast('✗ ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Install'; }
  }
}

async function installTheme(slug, downloadUrl) {
  const btn = document.getElementById('install-theme-' + slug);
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  try {
    const resp = await fetch('${prefix}/api/themes/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, downloadUrl }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Install failed');
    showToast('✓ Theme "' + slug + '" installed successfully!', 'success');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    showToast('✗ ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Install'; }
  }
}

function showToast(msg, type) {
  const toast = document.getElementById('mkt-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'mkt-toast mkt-toast--' + type;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 5000);
}
`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function marketplaceStyles(): string {
  return `
${baseAdminStyles()}
.mkt-header { margin-bottom: 1.25rem; }
.mkt-header h2 { margin: 0 0 0.25rem; font-size: 1.4rem; }
.mkt-subtitle { color: #666; margin: 0; font-size: 0.9rem; }
.mkt-tabs { display: flex; gap: 0; border-bottom: 2px solid #e5e7eb; margin-bottom: 1.25rem; }
.mkt-tab {
  background: none; border: none; cursor: pointer;
  padding: 0.6rem 1.2rem; font-size: 0.9rem; color: #666;
  border-bottom: 2px solid transparent; margin-bottom: -2px;
  display: flex; align-items: center; gap: 0.5rem; transition: color 0.1s;
}
.mkt-tab:hover { color: #333; }
.mkt-tab.active { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }
.mkt-tab-count {
  background: #f3f4f6; color: #555; font-size: 0.75rem;
  padding: 0.1em 0.45em; border-radius: 999px; font-weight: 400;
}
.mkt-tab-panel { }
.mkt-tab-panel.hidden { display: none; }
.mkt-panel-meta { font-size: 0.8rem; color: #888; margin: 0 0 1rem; }
.mkt-empty { color: #888; font-size: 0.9rem; }

/* ── Plugin list ── */
.mkt-plugin-list { display: flex; flex-direction: column; gap: 0.75rem; }
.plugin-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 1rem; display: flex; gap: 1rem; align-items: flex-start;
  transition: box-shadow 0.15s;
}
.plugin-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
.plugin-card-left { flex-shrink: 0; }
.plugin-icon-wrap {
  width: 48px; height: 48px; border-radius: 8px;
  background: #f3f4f6; display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.plugin-icon { width: 48px; height: 48px; object-fit: cover; }
.plugin-icon-fallback { font-size: 1.5rem; }
.plugin-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.plugin-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.plugin-meta { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.plugin-name { font-weight: 600; font-size: 0.95rem; }
.plugin-pkg { font-size: 0.75rem; color: #888; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 3px; }
.plugin-version { font-size: 0.75rem; color: #888; }
.plugin-description { font-size: 0.85rem; color: #555; margin: 0; }
.plugin-hooks { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; font-size: 0.8rem; }
.hooks-label { color: #888; }
.hook-badge { background: #eef2ff; color: #3730a3; padding: 0.1em 0.4em; border-radius: 3px; font-size: 0.75rem; font-family: monospace; }
.plugin-downloads { font-size: 0.8rem; color: #888; white-space: nowrap; }
.plugin-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: 0.25rem; }
.plugin-card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* ── Theme grid ── */
.mkt-themes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.theme-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  overflow: hidden; display: flex; flex-direction: column;
  transition: box-shadow 0.15s;
}
.theme-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.theme-card-screenshot {
  aspect-ratio: 16/9; background: #f3f4f6;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.theme-card-screenshot img { width: 100%; height: 100%; object-fit: cover; }
.theme-placeholder-icon { font-size: 2.5rem; opacity: 0.4; }
.theme-card-body { padding: 0.875rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
.theme-card-meta { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.theme-name { font-weight: 600; font-size: 0.95rem; }
.theme-version { font-size: 0.75rem; color: #888; }
.theme-author { font-size: 0.8rem; color: #666; margin: 0; }
.theme-description { font-size: 0.85rem; color: #555; margin: 0; flex: 1; }
.theme-card-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }

/* ── Shared ── */
.mkt-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.mkt-tag { font-size: 0.7rem; background: #f3f4f6; color: #555; padding: 0.1em 0.45em; border-radius: 4px; }
.mkt-badge {
  font-size: 0.7rem; font-weight: 600; padding: 0.1em 0.5em;
  border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em;
}
.mkt-badge--verified { background: #dbeafe; color: #1d4ed8; }
.mkt-badge--installed { background: #d1fae5; color: #065f46; }
.compat-label { font-size: 0.75rem; color: #888; }
.btn-disabled { opacity: 0.5; cursor: default; pointer-events: none; }
.mkt-toast {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  padding: 0.75rem 1.25rem; border-radius: 6px; font-size: 0.9rem;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 9999;
  max-width: 420px;
}
.mkt-toast--success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
.mkt-toast--error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
`;
}

// ─── Shell layout ─────────────────────────────────────────────────────────────

function adminShellPartial(
  prefix: string,
  active: string,
  userName: string,
  content: string,
): string {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "📊", href: `${prefix}/` },
    { id: "pages", label: "Pages", icon: "📄", href: `${prefix}/pages` },
    { id: "media", label: "Media", icon: "🖼️", href: `${prefix}/media` },
    { id: "i18n", label: "Translations", icon: "🌐", href: `${prefix}/i18n` },
    { id: "flex", label: "Flex Objects", icon: "🗃️", href: `${prefix}/flex` },
    { id: "submissions", label: "Submissions", icon: "📬", href: `${prefix}/submissions` },
    { id: "users", label: "Users", icon: "👥", href: `${prefix}/users` },
    { id: "plugins", label: "Plugins", icon: "🔌", href: `${prefix}/plugins` },
    { id: "themes", label: "Themes", icon: "🎨", href: `${prefix}/themes` },
    { id: "marketplace", label: "Marketplace", icon: "🛒", href: `${prefix}/marketplace` },
    { id: "config", label: "Config", icon: "⚙️", href: `${prefix}/config` },
  ];

  return `<div class="admin-layout">
    <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>
    <aside class="admin-sidebar" id="admin-sidebar">
      <div class="sidebar-brand">
        <a href="${prefix}/">🏜️ Dune</a>
        <button class="sidebar-close" onclick="closeSidebar()" aria-label="Close menu">✕</button>
      </div>
      <nav class="sidebar-nav">
        ${navItems.map((item) => `
        <a href="${item.href}" class="nav-item ${active === item.id ? "active" : ""}" onclick="closeSidebar()">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </a>`).join("")}
      </nav>
    </aside>
    <main class="admin-main">
      <header class="admin-topbar">
        <div class="topbar-left">
          <button class="sidebar-toggle" onclick="openSidebar()" aria-label="Open menu">☰</button>
          <a href="/" target="_blank" class="btn btn-sm">View Site →</a>
        </div>
        <div class="topbar-right">
          <span class="user-name">${escHtml(userName)}</span>
          <form method="POST" action="${prefix}/logout" style="display:inline">
            <button type="submit" class="btn btn-sm btn-outline">Logout</button>
          </form>
        </div>
      </header>
      <div class="admin-content">${content}</div>
    </main>
  </div>
  <script>
  function openSidebar() {
    document.getElementById('admin-sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    document.getElementById('admin-sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }
  </script>`;
}

// ─── Base admin styles ────────────────────────────────────────────────────────

function baseAdminStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; color: #1a1a1a; background: #f8f9fa; }
a { color: inherit; text-decoration: none; }
.admin-layout { display: flex; min-height: 100vh; }
.admin-sidebar {
  width: 220px; background: #1e1e2e; color: #cdd6f4; flex-shrink: 0;
  display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh;
  z-index: 200; transition: transform 0.25s;
}
.sidebar-brand { padding: 1rem 1rem 0.5rem; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; justify-content: space-between; }
.sidebar-brand a { color: #cdd6f4; }
.sidebar-close { background: none; border: none; color: #888; font-size: 1.1rem; cursor: pointer; display: none; }
.sidebar-nav { padding: 0.5rem 0; overflow-y: auto; flex: 1; }
.nav-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 1rem; color: #a6adc8; transition: background 0.1s, color 0.1s; }
.nav-item:hover { background: rgba(255,255,255,0.06); color: #cdd6f4; }
.nav-item.active { background: rgba(255,255,255,0.1); color: #cba6f7; }
.nav-icon { font-size: 1rem; width: 1.2rem; text-align: center; }
.admin-main { margin-left: 220px; flex: 1; display: flex; flex-direction: column; min-width: 0; }
.admin-topbar { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 0.6rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; position: sticky; top: 0; z-index: 100; }
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
.sidebar-toggle { display: none; background: none; border: none; font-size: 1.3rem; cursor: pointer; padding: 0; }
.user-name { font-size: 0.85rem; color: #555; }
.admin-content { padding: 1.5rem; max-width: 1100px; }
.btn { display: inline-block; padding: 0.4rem 0.85rem; border-radius: 5px; border: 1px solid #d1d5db; background: #fff; color: #374151; font-size: 0.85rem; cursor: pointer; transition: background 0.1s; white-space: nowrap; }
.btn:hover { background: #f9fafb; }
.btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-outline { background: transparent; }
.btn-sm { padding: 0.3rem 0.65rem; font-size: 0.8rem; }
.sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 190; }
@media (max-width: 767px) {
  .admin-sidebar { transform: translateX(-100%); }
  .admin-sidebar.open { transform: translateX(0); }
  .sidebar-overlay.open { display: block; }
  .sidebar-close { display: block; }
  .sidebar-toggle { display: block; }
  .admin-main { margin-left: 0; }
}
`;
}

// ─── HTML escaping ────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
