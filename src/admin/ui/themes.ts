/**
 * Theme marketplace admin UI.
 *
 * Renders the /admin/themes page — shows locally installed themes and
 * themes available from the bundled registry, with install and preview
 * functionality.
 */

import type { ThemeManifest } from "../../themes/types.ts";
import type { AuthResult } from "../types.ts";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InstalledThemeInfo {
  slug: string;
  manifest: ThemeManifest;
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
}

export interface ThemeRegistry {
  version: number;
  updatedAt?: string;
  themes: ThemeRegistryEntry[];
}

// ─── Public render function ───────────────────────────────────────────────────

/**
 * Render the full themes marketplace page.
 *
 * @param prefix         Admin route prefix (e.g. "/admin")
 * @param installed      Locally installed themes with manifest data
 * @param currentTheme   Active theme slug
 * @param registry       Bundled registry of available themes
 * @param auth           Authenticated user info
 */
export function renderThemesPage(
  prefix: string,
  installed: InstalledThemeInfo[],
  currentTheme: string,
  registry: ThemeRegistry,
  auth: AuthResult,
): string {
  const userName = auth.user?.name ?? "Admin";
  const installedSlugs = new Set(installed.map((t) => t.slug));

  const installedSection = installed.length === 0
    ? `<p class="themes-empty">No themes found in the <code>themes/</code> directory.</p>`
    : installed.map((t) => renderInstalledCard(prefix, t, currentTheme)).join("\n");

  const registrySection = registry.themes.length === 0
    ? `<p class="themes-empty">No themes in registry.</p>`
    : registry.themes.map((t) =>
      renderRegistryCard(prefix, t, installedSlugs.has(t.slug), t.slug === currentTheme)
    ).join("\n");

  const content = `
    <div class="themes-header">
      <h2>Themes</h2>
      <p class="themes-subtitle">Manage your site's visual appearance. Switch themes from
        <a href="${prefix}/config#theme">Configuration → Theme</a>.</p>
    </div>

    <section class="themes-section">
      <h3 class="themes-section-title">Installed</h3>
      <div class="themes-grid">${installedSection}</div>
    </section>

    <section class="themes-section">
      <h3 class="themes-section-title">
        Available from registry
        <span class="registry-meta">${registry.themes.length} theme${registry.themes.length !== 1 ? "s" : ""}${registry.updatedAt ? ` · updated ${escHtml(registry.updatedAt)}` : ""}</span>
      </h3>
      <div class="themes-grid">${registrySection}</div>
    </section>

    <div id="install-toast" class="install-toast" style="display:none"></div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Themes — Dune Admin</title>
  <style>${themeStyles()}</style>
</head>
<body>
  ${adminShellPartial(prefix, "themes", userName, content)}
  <script>${themesScript(prefix)}</script>
</body>
</html>`;
}

// ─── Card renderers ───────────────────────────────────────────────────────────

function renderInstalledCard(
  prefix: string,
  theme: InstalledThemeInfo,
  currentTheme: string,
): string {
  const { slug, manifest } = theme;
  const isActive = slug === currentTheme;
  const version = manifest.version ? `v${escHtml(manifest.version)}` : "";
  const author = manifest.author ? `by ${escHtml(manifest.author)}` : "";

  return `
  <div class="theme-card theme-card--installed${isActive ? " theme-card--active" : ""}">
    <div class="theme-card-screenshot theme-card-screenshot--placeholder">
      <span class="theme-placeholder-icon">🎨</span>
    </div>
    <div class="theme-card-body">
      <div class="theme-card-meta">
        <span class="theme-name">${escHtml(manifest.name || slug)}</span>
        ${version ? `<span class="theme-version">${version}</span>` : ""}
        ${isActive ? `<span class="theme-badge theme-badge--active">Active</span>` : ""}
      </div>
      ${author ? `<p class="theme-author">${author}</p>` : ""}
      ${manifest.description ? `<p class="theme-description">${escHtml(manifest.description)}</p>` : ""}
      <div class="theme-card-actions">
        <button class="btn btn-sm"
          onclick="previewTheme('${escAttr(slug)}')"
          title="Preview this theme in the configuration editor">Preview</button>
        ${isActive
      ? `<span class="btn btn-sm btn-disabled">Active</span>`
      : `<button class="btn btn-sm btn-primary"
            onclick="setActiveTheme('${escAttr(slug)}')">Set Active</button>`}
      </div>
    </div>
  </div>`;
}

function renderRegistryCard(
  prefix: string,
  theme: ThemeRegistryEntry,
  isInstalled: boolean,
  isActive: boolean,
): string {
  const tags = (theme.tags ?? [])
    .map((t) => `<span class="theme-tag">${escHtml(t)}</span>`)
    .join("");

  const screenshot = theme.screenshotUrl
    ? `<img src="${escAttr(theme.screenshotUrl)}" alt="${escAttr(theme.name)} screenshot"
         loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : "";
  const placeholder = `<span class="theme-placeholder-icon" ${theme.screenshotUrl ? 'style="display:none"' : ""}>🎨</span>`;

  return `
  <div class="theme-card${isInstalled ? " theme-card--installed" : ""}">
    <div class="theme-card-screenshot">
      ${screenshot}${placeholder}
    </div>
    <div class="theme-card-body">
      <div class="theme-card-meta">
        <span class="theme-name">${escHtml(theme.name)}</span>
        <span class="theme-version">v${escHtml(theme.version)}</span>
        ${isActive ? `<span class="theme-badge theme-badge--active">Active</span>` : ""}
        ${isInstalled && !isActive ? `<span class="theme-badge theme-badge--installed">Installed</span>` : ""}
      </div>
      <p class="theme-author">by ${escHtml(theme.author)}${theme.license ? ` · ${escHtml(theme.license)}` : ""}</p>
      <p class="theme-description">${escHtml(theme.description)}</p>
      ${tags ? `<div class="theme-tags">${tags}</div>` : ""}
      <div class="theme-card-actions">
        ${theme.demoUrl
      ? `<a href="${escAttr(theme.demoUrl)}" target="_blank" rel="noopener"
             class="btn btn-sm">Demo ↗</a>`
      : ""}
        ${isInstalled
      ? `<span class="btn btn-sm btn-disabled">Installed ✓</span>`
      : `<button class="btn btn-sm btn-primary"
              id="install-btn-${escAttr(theme.slug)}"
              onclick="installTheme('${escAttr(theme.slug)}', '${escAttr(theme.downloadUrl)}')">
            Install
          </button>`}
      </div>
    </div>
  </div>`;
}

// ─── JavaScript ───────────────────────────────────────────────────────────────

function themesScript(prefix: string): string {
  return `
async function installTheme(slug, downloadUrl) {
  const btn = document.getElementById('install-btn-' + slug);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Installing…';
  }
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
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Install';
    }
  }
}

function previewTheme(slug) {
  // Navigate to config editor with theme pre-selected for preview
  window.location.href = '${prefix}/config?preview_theme=' + encodeURIComponent(slug) + '#theme';
}

function setActiveTheme(slug) {
  window.location.href = '${prefix}/config?switch_theme=' + encodeURIComponent(slug) + '#theme';
}

function showToast(msg, type) {
  const toast = document.getElementById('install-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'install-toast install-toast--' + type;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}
`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

export function themeStyles(): string {
  return `
${baseAdminStyles()}
.themes-header { margin-bottom: 1.5rem; }
.themes-header h2 { margin: 0 0 0.25rem; font-size: 1.4rem; }
.themes-subtitle { color: #666; margin: 0; font-size: 0.9rem; }
.themes-subtitle a { color: #2563eb; }
.themes-section { margin-bottom: 2rem; }
.themes-section-title {
  font-size: 1rem; font-weight: 600; color: #333;
  margin: 0 0 0.75rem; display: flex; align-items: baseline; gap: 0.75rem;
}
.registry-meta { font-size: 0.8rem; font-weight: 400; color: #888; }
.themes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.themes-empty { color: #888; font-size: 0.9rem; }
.theme-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  overflow: hidden; display: flex; flex-direction: column;
  transition: box-shadow 0.15s;
}
.theme-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.theme-card--active { border-color: #2563eb; }
.theme-card-screenshot {
  aspect-ratio: 16/9; background: #f3f4f6;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; position: relative;
}
.theme-card-screenshot img { width: 100%; height: 100%; object-fit: cover; }
.theme-card-screenshot--placeholder { background: linear-gradient(135deg, #e0e7ef 0%, #f3f4f6 100%); }
.theme-placeholder-icon { font-size: 2.5rem; opacity: 0.4; }
.theme-card-body { padding: 0.875rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
.theme-card-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.theme-name { font-weight: 600; font-size: 0.95rem; }
.theme-version { font-size: 0.75rem; color: #888; }
.theme-author { font-size: 0.8rem; color: #666; margin: 0; }
.theme-description { font-size: 0.85rem; color: #555; margin: 0; flex: 1; }
.theme-badge {
  font-size: 0.7rem; font-weight: 600; padding: 0.1em 0.5em;
  border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em;
}
.theme-badge--active { background: #dbeafe; color: #1d4ed8; }
.theme-badge--installed { background: #d1fae5; color: #065f46; }
.theme-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.2rem; }
.theme-tag {
  font-size: 0.7rem; background: #f3f4f6; color: #555;
  padding: 0.1em 0.45em; border-radius: 4px;
}
.theme-card-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }
.btn-disabled { opacity: 0.5; cursor: default; pointer-events: none; }
.install-toast {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  padding: 0.75rem 1.25rem; border-radius: 6px; font-size: 0.9rem;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 9999;
  max-width: 360px;
}
.install-toast--success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
.install-toast--error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
`;
}

// ─── Shell layout (inline) ────────────────────────────────────────────────────

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

// ─── Base admin styles (minimal shared subset) ────────────────────────────────

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
.admin-content { padding: 1.5rem; max-width: 1200px; }
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
