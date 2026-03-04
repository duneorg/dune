/**
 * Admin UI pages — server-rendered HTML for login, dashboard, and shell.
 *
 * These are plain HTML strings (no JSX dependency) to keep the admin
 * UI lightweight and self-contained.
 */

import type { DuneEngine } from "../../core/engine.ts";
import type { AuthResult } from "../types.ts";

/**
 * Render the login page.
 */
export function renderLoginPage(prefix: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — Dune Admin</title>
  <style>${adminStyles()}</style>
</head>
<body class="login-body">
  <div class="login-card">
    <div class="login-header">
      <h1>🏜️ Dune</h1>
      <p>Admin Panel</p>
    </div>
    ${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="${prefix}/login">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autofocus>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
      </div>
      <button type="submit" class="btn btn-primary">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Render the dashboard page.
 */
export function renderDashboardPage(
  prefix: string,
  engine: DuneEngine,
  authResult: AuthResult,
): string {
  const pages = engine.pages;
  const published = pages.filter((p) => p.published).length;
  const draft = pages.filter((p) => !p.published).length;
  const mdCount = pages.filter((p) => p.format === "md").length;
  const mdxCount = pages.filter((p) => p.format === "mdx").length;
  const tsxCount = pages.filter((p) => p.format === "tsx").length;

  const userName = authResult.user?.name ?? "Admin";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — Dune Admin</title>
  <style>${adminStyles()}</style>
</head>
<body>
  ${adminShell(prefix, "dashboard", userName, `
    <h2>Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${pages.length}</div>
        <div class="stat-label">Total Pages</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${published}</div>
        <div class="stat-label">Published</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${draft}</div>
        <div class="stat-label">Drafts</div>
      </div>
    </div>

    <h3>Content by Format</h3>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${mdCount}</div>
        <div class="stat-label">Markdown (.md)</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${mdxCount}</div>
        <div class="stat-label">MDX (.mdx)</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${tsxCount}</div>
        <div class="stat-label">TSX (.tsx)</div>
      </div>
    </div>

    <h3>Recent Pages</h3>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Route</th>
          <th>Title</th>
          <th>Format</th>
          <th>Published</th>
        </tr>
      </thead>
      <tbody>
        ${pages.slice(0, 10).map((p) => `
        <tr>
          <td><code>${escapeHtml(p.route)}</code></td>
          <td>${escapeHtml(p.title)}</td>
          <td><span class="badge badge-${p.format}">${p.format}</span></td>
          <td>${p.published ? "✅" : "📝"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `)}
</body>
</html>`;
}

/**
 * Render a shell page for a specific section (pages, media, users).
 */
export function renderShellPage(
  prefix: string,
  section: string,
  authResult: AuthResult,
): string {
  const userName = authResult.user?.name ?? "Admin";
  const sectionTitle = section.charAt(0).toUpperCase() + section.slice(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sectionTitle} — Dune Admin</title>
  <style>${adminStyles()}</style>
</head>
<body>
  ${adminShell(prefix, section, userName, `
    <h2>${sectionTitle}</h2>
    <div id="admin-content" data-section="${section}" data-prefix="${prefix}">
      <p>Loading...</p>
    </div>
    <script>
      // Fetch section data from admin API
      fetch('${prefix}/api/${section === "dashboard" ? "dashboard" : "pages"}')
        .then(r => r.json())
        .then(data => {
          const el = document.getElementById('admin-content');
          if (data.items) {
            el.innerHTML = '<table class="admin-table"><thead><tr><th>Route</th><th>Title</th><th>Format</th></tr></thead><tbody>' +
              data.items.map(p => '<tr><td><code>' + p.route + '</code></td><td>' + (p.title || '') + '</td><td>' + p.format + '</td></tr>').join('') +
              '</tbody></table>';
          }
        })
        .catch(e => {
          document.getElementById('admin-content').innerHTML = '<p>Error loading data.</p>';
        });
    </script>
  `)}
</body>
</html>`;
}

// === Admin shell (sidebar + top bar) ===

function adminShell(prefix: string, active: string, userName: string, content: string): string {
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

  return `
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="sidebar-brand">
        <a href="${prefix}/">🏜️ Dune</a>
      </div>
      <nav class="sidebar-nav">
        ${navItems.map((item) => `
        <a href="${item.href}" class="nav-item ${active === item.id ? "active" : ""}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </a>`).join("")}
      </nav>
    </aside>
    <main class="admin-main">
      <header class="admin-topbar">
        <div class="topbar-left">
          <a href="/" target="_blank" class="btn btn-sm">View Site →</a>
        </div>
        <div class="topbar-right">
          <span class="user-name">${escapeHtml(userName)}</span>
          <form method="POST" action="${prefix}/logout" style="display:inline">
            <button type="submit" class="btn btn-sm btn-outline">Logout</button>
          </form>
        </div>
      </header>
      <div class="admin-content">
        ${content}
      </div>
    </main>
  </div>`;
}

// === Styles ===

function adminStyles(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #333; }

  /* Login */
  .login-body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1a1a2e; }
  .login-card { background: #fff; border-radius: 12px; padding: 2rem; width: 100%; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.2); }
  .login-header { text-align: center; margin-bottom: 1.5rem; }
  .login-header h1 { font-size: 2rem; margin-bottom: 0.25rem; }
  .login-header p { color: #666; }

  /* Forms */
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.9rem; color: #555; }
  .form-group input { width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem; }
  .form-group input:focus { outline: none; border-color: #c9a96e; box-shadow: 0 0 0 3px rgba(201,169,110,0.2); }

  /* Buttons */
  .btn { display: inline-block; padding: 0.6rem 1.2rem; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; text-decoration: none; }
  .btn-primary { background: #c9a96e; color: #fff; width: 100%; font-weight: 600; }
  .btn-primary:hover { background: #b8944f; }
  .btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
  .btn-outline { background: transparent; border: 1px solid #ddd; color: #666; }
  .btn-outline:hover { background: #f0f0f0; }

  /* Alerts */
  .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
  .alert-error { background: #fee; color: #c33; border: 1px solid #fcc; }

  /* Admin layout */
  .admin-layout { display: flex; min-height: 100vh; }
  .admin-sidebar { width: 240px; background: #1a1a2e; color: #ccc; flex-shrink: 0; }
  .sidebar-brand { padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .sidebar-brand a { color: #fff; text-decoration: none; font-size: 1.25rem; font-weight: 700; }
  .sidebar-nav { padding: 0.5rem 0; }
  .nav-item { display: flex; align-items: center; padding: 0.65rem 1.25rem; color: #aaa; text-decoration: none; font-size: 0.9rem; transition: all 0.15s; }
  .nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
  .nav-item.active { color: #c9a96e; background: rgba(201,169,110,0.1); border-right: 3px solid #c9a96e; }
  .nav-icon { margin-right: 0.75rem; font-size: 1.1rem; }

  /* Main content */
  .admin-main { flex: 1; display: flex; flex-direction: column; }
  .admin-topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: #fff; border-bottom: 1px solid #e0e0e0; }
  .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
  .user-name { color: #666; font-size: 0.85rem; }
  .admin-content { padding: 1.5rem; flex: 1; }

  /* Stats grid */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .stat-card { background: #fff; border-radius: 8px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-number { font-size: 2rem; font-weight: 700; color: #1a1a2e; }
  .stat-label { color: #888; font-size: 0.85rem; margin-top: 0.25rem; }

  /* Tables */
  .admin-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .admin-table th, .admin-table td { padding: 0.65rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
  .admin-table th { background: #f8f8f8; font-weight: 600; font-size: 0.85rem; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .admin-table code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85rem; }

  /* Badges */
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge-md { background: #e8f4f8; color: #1a7a9b; }
  .badge-mdx { background: #f0e8f8; color: #7a1a9b; }
  .badge-tsx { background: #e8f8e8; color: #1a7a3b; }

  h2 { margin-bottom: 1rem; color: #1a1a2e; }
  h3 { margin-bottom: 0.75rem; color: #444; font-size: 1rem; }
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
