/**
 * Plugin management admin UI.
 *
 * Renders the /admin/plugins page — lists registered plugins, shows
 * hook subscriptions, and provides a blueprint-driven config form for
 * plugins that declare a configSchema.
 */

import type { DunePlugin } from "../../hooks/types.ts";
import type { AuthResult } from "../types.ts";

// ─── Public render functions ──────────────────────────────────────────────────

/**
 * Render the full plugin management page.
 *
 * @param prefix  Admin route prefix (e.g. "/admin")
 * @param plugins Registered plugin list from hooks.plugins()
 * @param configs Current plugin configs (config.plugins)
 * @param auth    Authenticated user info
 */
export function renderPluginsPage(
  prefix: string,
  plugins: DunePlugin[],
  configs: Record<string, Record<string, unknown>>,
  _auth: AuthResult,
): string {
  const userName = _auth.user?.name ?? "Admin";

  const content = plugins.length === 0
    ? renderEmpty(prefix)
    : plugins.map((p) => renderPluginCard(prefix, p, configs[p.name] ?? {})).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugins — Dune Admin</title>
  <style>${pluginStyles()}</style>
</head>
<body>
  ${adminShellPartial(prefix, "plugins", userName, `
    <div class="plugins-header">
      <h2>Plugins</h2>
      <p class="plugins-subtitle">
        Manage installed plugins. Add plugins via <code>config/site.yaml</code>
        or with <code>dune plugin:install &lt;src&gt;</code>.
      </p>
    </div>
    ${content}
    ${pluginScript(prefix)}
  `)}
</body>
</html>`;
}

/**
 * Render a single plugin config form (used in the save API response preview).
 */
export function renderPluginConfigForm(
  prefix: string,
  plugin: DunePlugin,
  currentConfig: Record<string, unknown>,
): string {
  if (!plugin.configSchema || Object.keys(plugin.configSchema).length === 0) {
    return "<p>This plugin has no configurable fields.</p>";
  }

  return `<form id="plugin-config-form-${escAttr(plugin.name)}"
    data-plugin="${escAttr(plugin.name)}"
    class="plugin-config-form"
    onsubmit="savePluginConfig(event, '${escAttr(plugin.name)}')">
    ${renderConfigFields(plugin, currentConfig)}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save config</button>
      <span class="save-status" id="save-status-${escAttr(plugin.name)}"></span>
    </div>
  </form>`;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function renderEmpty(prefix: string): string {
  return `<div class="plugins-empty">
    <p>No plugins are currently installed.</p>
    <p>To add a plugin:</p>
    <pre>
# config/site.yaml
plugins:
  - src: "./plugins/my-plugin.ts"
  - src: "jsr:@scope/plugin-name"
    config:
      key: value</pre>
    <p>Or use the CLI:</p>
    <pre>dune plugin:install jsr:@scope/plugin-name
dune plugin:create my-plugin   # scaffold a new plugin</pre>
    <p><a href="${prefix}/" class="btn btn-outline">← Dashboard</a></p>
  </div>`;
}

function renderPluginCard(
  prefix: string,
  plugin: DunePlugin,
  currentConfig: Record<string, unknown>,
): string {
  const hookNames = Object.keys(plugin.hooks);
  const hasConfig = plugin.configSchema && Object.keys(plugin.configSchema).length > 0;

  const hookBadges = hookNames.length > 0
    ? hookNames.map((h) => `<span class="hook-badge">${escHtml(h)}</span>`).join(" ")
    : '<span class="no-hooks">no hooks</span>';

  const configSection = hasConfig
    ? `<details class="plugin-config-details">
        <summary>Configure</summary>
        <div class="plugin-config-body">
          ${renderConfigFields(plugin, currentConfig)}
          <div class="form-actions">
            <button class="btn btn-primary btn-sm"
              onclick="savePluginConfig(event, '${escAttr(plugin.name)}')">
              Save config
            </button>
            <span class="save-status" id="save-status-${escAttr(plugin.name)}"></span>
          </div>
        </div>
      </details>`
    : "";

  return `<div class="plugin-card" data-plugin="${escAttr(plugin.name)}">
  <div class="plugin-card-header">
    <div class="plugin-info">
      <span class="plugin-name">${escHtml(plugin.name)}</span>
      <span class="plugin-version">v${escHtml(plugin.version)}</span>
      ${plugin.author ? `<span class="plugin-author">by ${escHtml(plugin.author)}</span>` : ""}
    </div>
    <div class="plugin-status active">active</div>
  </div>
  ${plugin.description ? `<p class="plugin-description">${escHtml(plugin.description)}</p>` : ""}
  <div class="plugin-hooks">
    <span class="hooks-label">Hooks:</span> ${hookBadges}
  </div>
  ${configSection}
</div>`;
}

function renderConfigFields(
  plugin: DunePlugin,
  currentConfig: Record<string, unknown>,
): string {
  if (!plugin.configSchema) return "";

  return Object.entries(plugin.configSchema).map(([key, field]) => {
    const value = currentConfig[key] ?? field.default ?? "";
    const id = `cfg-${escAttr(plugin.name)}-${escAttr(key)}`;

    let input: string;

    if (field.type === "toggle") {
      const checked = value === true ? "checked" : "";
      input = `<input type="checkbox" id="${id}" name="${escAttr(key)}"
        data-field="${escAttr(key)}" data-type="toggle" ${checked}>`;
    } else if (field.type === "select" && field.options) {
      const opts = Object.entries(field.options)
        .map(([v, label]) =>
          `<option value="${escAttr(v)}" ${value === v ? "selected" : ""}>${escHtml(label)}</option>`,
        )
        .join("");
      input = `<select id="${id}" name="${escAttr(key)}" data-field="${escAttr(key)}">${opts}</select>`;
    } else if (field.type === "textarea" || field.type === "markdown") {
      input = `<textarea id="${id}" name="${escAttr(key)}" data-field="${escAttr(key)}"
        rows="4">${escHtml(String(value))}</textarea>`;
    } else if (field.type === "number") {
      const min = field.validate?.min !== undefined ? `min="${field.validate.min}"` : "";
      const max = field.validate?.max !== undefined ? `max="${field.validate.max}"` : "";
      input = `<input type="number" id="${id}" name="${escAttr(key)}"
        data-field="${escAttr(key)}" value="${escAttr(String(value))}" ${min} ${max}>`;
    } else {
      // text, date, file, color
      const inputType = field.type === "date" ? "date"
        : field.type === "color" ? "color"
        : "text";
      input = `<input type="${inputType}" id="${id}" name="${escAttr(key)}"
        data-field="${escAttr(key)}" value="${escAttr(String(value))}">`;
    }

    const required = field.required ? ' <span class="required-mark">*</span>' : "";

    return `<div class="config-field">
      <label for="${id}">${escHtml(field.label)}${required}</label>
      ${input}
    </div>`;
  }).join("\n");
}

// ─── Client-side script ───────────────────────────────────────────────────────

function pluginScript(prefix: string): string {
  return `<script>
function savePluginConfig(event, pluginName) {
  event.preventDefault();
  const card = document.querySelector('[data-plugin="' + pluginName + '"]');
  if (!card) return;

  // Collect field values from data-field attributes
  const fields = card.querySelectorAll('[data-field]');
  const config = {};
  fields.forEach(el => {
    const key = el.dataset.field;
    if (el.dataset.type === 'toggle') {
      config[key] = el.checked;
    } else {
      config[key] = el.value;
    }
  });

  const statusEl = document.getElementById('save-status-' + pluginName);
  if (statusEl) statusEl.textContent = 'Saving…';

  fetch('${prefix}/api/plugins/' + encodeURIComponent(pluginName) + '/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
    .then(r => r.json())
    .then(data => {
      if (statusEl) statusEl.textContent = data.saved ? '✓ Saved' : '✗ Error';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    })
    .catch(() => { if (statusEl) statusEl.textContent = '✗ Network error'; });
}
</script>`;
}

// ─── Shell layout (inline — avoids importing from pages.ts) ──────────────────

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
    { id: "flex", label: "Flex Objects", icon: "🗂️", href: `${prefix}/flex` },
    { id: "submissions", label: "Submissions", icon: "📬", href: `${prefix}/submissions` },
    { id: "users", label: "Users", icon: "👥", href: `${prefix}/users` },
    { id: "plugins", label: "Plugins", icon: "🔌", href: `${prefix}/plugins` },
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

// ─── Styles ───────────────────────────────────────────────────────────────────

export function pluginStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #222; background: #f5f5f5; }
.admin-layout { display: flex; min-height: 100vh; }
.admin-sidebar { width: 220px; background: #1a1a2e; color: #ccc; flex-shrink: 0; }
.sidebar-brand { padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
.sidebar-brand a { color: #fff; text-decoration: none; font-size: 1.2rem; font-weight: 700; }
.sidebar-nav { padding: 0.5rem 0; }
.nav-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 1.25rem; color: #aaa; text-decoration: none; font-size: 0.9rem; }
.nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
.nav-item.active { color: #c9a96e; background: rgba(201,169,110,0.1); border-right: 3px solid #c9a96e; }
.admin-main { flex: 1; display: flex; flex-direction: column; }
.admin-topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: #fff; border-bottom: 1px solid #e5e5e5; }
.admin-content { flex: 1; padding: 1.5rem; }
.btn { display: inline-block; padding: 0.4rem 0.9rem; border-radius: 4px; border: none; cursor: pointer; font-size: 0.85rem; text-decoration: none; background: #e0e0e0; color: #222; }
.btn-primary { background: #c9a96e; color: #fff; }
.btn-outline { background: transparent; border: 1px solid #ccc; }
.btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
.plugins-header { margin-bottom: 1.5rem; }
.plugins-header h2 { margin: 0 0 0.4rem; }
.plugins-subtitle { color: #666; margin: 0; }
.plugins-subtitle code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; }
.plugins-empty { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 2rem; }
.plugins-empty pre { background: #f5f5f5; padding: 0.75rem 1rem; border-radius: 4px; font-size: 0.85rem; overflow-x: auto; }
.plugin-card { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.25rem; margin-bottom: 1rem; }
.plugin-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.plugin-info { display: flex; align-items: baseline; gap: 0.5rem; }
.plugin-name { font-weight: 600; font-size: 1rem; }
.plugin-version { font-size: 0.8rem; color: #888; }
.plugin-author { font-size: 0.8rem; color: #888; }
.plugin-status { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 3px; font-weight: 500; }
.plugin-status.active { background: #d4edda; color: #155724; }
.plugin-description { color: #555; margin: 0.25rem 0 0.75rem; font-size: 0.9rem; }
.plugin-hooks { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 0.85rem; }
.hooks-label { color: #888; }
.hook-badge { background: #eef2ff; color: #3730a3; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.78rem; font-family: monospace; }
.no-hooks { color: #bbb; font-style: italic; font-size: 0.85rem; }
.plugin-config-details { margin-top: 1rem; border-top: 1px solid #f0f0f0; padding-top: 0.75rem; }
.plugin-config-details summary { cursor: pointer; color: #555; font-size: 0.9rem; padding: 0.25rem 0; }
.plugin-config-body { padding-top: 0.75rem; }
.config-field { margin-bottom: 0.9rem; }
.config-field label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem; color: #444; }
.config-field input[type=text], .config-field input[type=number], .config-field input[type=date], .config-field select, .config-field textarea { width: 100%; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
.config-field textarea { resize: vertical; }
.required-mark { color: #c00; }
.form-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; }
.save-status { font-size: 0.85rem; color: #555; }

/* ── Mobile responsive ── */
.topbar-left { display: flex; align-items: center; gap: 0.5rem; }
.sidebar-toggle { display: none; background: none; border: none; font-size: 1.4rem; cursor: pointer; color: #333; padding: 0.25rem; line-height: 1; }
.sidebar-close { display: none; background: none; border: none; font-size: 1.1rem; cursor: pointer; color: #aaa; padding: 0.25rem; line-height: 1; margin-left: auto; }
.sidebar-brand { display: flex; align-items: center; justify-content: space-between; }
.sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99; }
.sidebar-overlay.open { display: block; }

@media (max-width: 767px) {
  .sidebar-toggle { display: block; }
  .sidebar-close { display: flex; align-items: center; justify-content: center; }
  .admin-sidebar {
    position: fixed;
    top: 0; left: 0;
    height: 100dvh;
    width: 220px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    z-index: 100;
  }
  .admin-sidebar.open { transform: translateX(0); }
  .admin-main { width: 100%; }
  .admin-content { padding: 1rem; }
  .admin-topbar { padding: 0.6rem 1rem; }
  .plugins-header h2 { font-size: 1.1rem; }
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
