/** @jsxImportSource preact */
/**
 * Admin shell layout — sidebar nav, top bar, content slot.
 * Applied to all routes under src/admin/routes/ via Fresh 2 layout convention.
 */

import { h } from "preact";
import type { FreshContext } from "fresh";
import type { AdminState } from "../types.ts";
import { getNavItems } from "../nav.ts";
import { getAdminContext } from "../context.ts";
import { isRtl } from "../../i18n/rtl.ts";
import { ROLE_PERMISSIONS } from "../types.ts";

export default function AdminLayout(
  { Component, state, url }: { Component: () => h.JSX.Element; state: AdminState; url: URL },
) {
  const { config, prefix } = getAdminContext();
  const siteLang = config.system.languages?.default ?? "en";
  const rtlOverride = config.system.languages?.rtl_override;
  const dir = isRtl(siteLang, rtlOverride) ? "rtl" : "ltr";

  const user = state.auth?.user;
  const userName = user?.name ?? user?.username ?? "Admin";
  const role = user?.role ?? "author";
  const userPermissions = ROLE_PERMISSIONS[role] ?? [];

  const allNavItems = getNavItems();
  const navItems = allNavItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.permission && !userPermissions.includes(item.permission)) return false;
    return true;
  });

  const pathname = url.pathname;
  const adminRelative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

  function isActive(path: string): boolean {
    if (path === "/") return adminRelative === "/" || adminRelative === "";
    return adminRelative.startsWith(path);
  }

  // Group nav items
  const groups = ["content", "media", "settings", "system"] as const;
  const grouped = new Map<string, typeof navItems>();
  for (const item of navItems) {
    const g = item.group ?? "content";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(item);
  }

  return (
    <html lang={siteLang} dir={dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Dune Admin</title>
        <style>{adminCss(dir === "rtl")}</style>
      </head>
      <body>
        <div class="admin-layout">
          <div class="sidebar-overlay" id="sidebar-overlay" />
          <aside class="admin-sidebar" id="admin-sidebar">
            <div class="sidebar-brand">
              <a href={`${prefix}/`}>🏜️ Dune</a>
              <button class="sidebar-close" id="sidebar-close" aria-label="Close menu">✕</button>
            </div>
            <nav class="sidebar-nav">
              {groups.map((group) => {
                const items = grouped.get(group);
                if (!items || items.length === 0) return null;
                return (
                  <div class="nav-group" key={group}>
                    <div class="nav-group-label">{group}</div>
                    {items.map((item) => (
                      <a
                        key={item.path}
                        href={`${prefix}${item.path}`}
                        class={`nav-item${isActive(item.path) ? " active" : ""}`}
                      >
                        <span class="nav-label">{item.label}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
              {/* Plugin-contributed groups */}
              {Array.from(grouped.entries())
                .filter(([g]) => !(groups as readonly string[]).includes(g))
                .map(([group, items]) => (
                  <div class="nav-group" key={group}>
                    <div class="nav-group-label">{group}</div>
                    {items.map((item) => (
                      <a
                        key={item.path}
                        href={`${prefix}${item.path}`}
                        class={`nav-item${isActive(item.path) ? " active" : ""}`}
                      >
                        <span class="nav-label">{item.label}</span>
                      </a>
                    ))}
                  </div>
                ))}
            </nav>
          </aside>
          <main class="admin-main">
            <header class="admin-topbar">
              <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Open menu">☰</button>
              <div class="topbar-right">
                <span class="topbar-user">{userName}</span>
                <form method="POST" action={`${prefix}/login/logout`} style="display:inline">
                  <button type="submit" class="btn btn-sm">Sign out</button>
                </form>
              </div>
            </header>
            <div class="admin-content">
              <Component />
            </div>
          </main>
        </div>
        <script dangerouslySetInnerHTML={{ __html: sidebarScript() }} />
      </body>
    </html>
  );
}

function sidebarScript(): string {
  return `
    const toggle = document.getElementById('sidebar-toggle');
    const close = document.getElementById('sidebar-close');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('admin-sidebar');
    function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('visible'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }
    toggle?.addEventListener('click', openSidebar);
    close?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
  `;
}

function adminCss(rtl: boolean): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 220px;
      --topbar-h: 52px;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --bg: #f8f9fa;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #1a202c;
      --text-muted: #718096;
      --danger: #e53e3e;
    }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
    a { color: inherit; text-decoration: none; }

    /* Layout */
    .admin-layout { display: flex; min-height: 100vh; }
    .admin-sidebar {
      width: var(--sidebar-w); min-height: 100vh; background: var(--surface);
      border-${rtl ? "left" : "right"}: 1px solid var(--border);
      display: flex; flex-direction: column; flex-shrink: 0;
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
    }
    .admin-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .admin-content { flex: 1; padding: 24px; }

    /* Sidebar */
    .sidebar-brand {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px; font-size: 18px; font-weight: 700; border-bottom: 1px solid var(--border);
    }
    .sidebar-brand a { color: var(--text); }
    .sidebar-close { display: none; background: none; border: none; cursor: pointer; font-size: 18px; }
    .sidebar-nav { padding: 12px 0; }
    .nav-group { margin-bottom: 4px; }
    .nav-group-label {
      padding: 6px 16px 2px; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted);
    }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; border-radius: 6px; margin: 0 8px;
      color: var(--text); font-size: 14px; transition: background .15s;
    }
    .nav-item:hover { background: var(--bg); }
    .nav-item.active { background: #eef2ff; color: var(--accent); font-weight: 500; }

    /* Top bar */
    .admin-topbar {
      height: var(--topbar-h); display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
    }
    .sidebar-toggle {
      background: none; border: none; cursor: pointer; font-size: 20px; padding: 4px 8px;
    }
    .topbar-right { display: flex; align-items: center; gap: 12px; }
    .topbar-user { font-size: 14px; color: var(--text-muted); }

    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500;
      border: 1px solid var(--border); background: var(--surface); cursor: pointer;
      color: var(--text); transition: background .15s;
    }
    .btn:hover { background: var(--bg); }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-sm { padding: 4px 10px; font-size: 13px; }
    .btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }

    /* Tables */
    .admin-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .admin-table th { text-align: ${rtl ? "right" : "left"}; padding: 10px 12px; background: var(--bg); border-bottom: 1px solid var(--border); font-weight: 600; }
    .admin-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .admin-table tr:hover td { background: var(--bg); }

    /* Forms */
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input[type=text], input[type=email], input[type=password], select, textarea {
      width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
      font-size: 14px; background: var(--surface);
    }
    input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); border-color: transparent; }

    /* Alerts */
    .alert { padding: 10px 14px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
    .alert-error { background: #fff5f5; border: 1px solid #fed7d7; color: var(--danger); }
    .alert-success { background: #f0fff4; border: 1px solid #c6f6d5; color: #276749; }

    /* Stats */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .stat-number { font-size: 28px; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .badge-md { background: #ebf8ff; color: #2b6cb0; }
    .badge-mdx { background: #f0fff4; color: #276749; }
    .badge-tsx { background: #faf5ff; color: #6b46c1; }

    /* Overlay + mobile sidebar */
    .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 40; }
    .sidebar-overlay.visible { display: block; }
    @media (max-width: 768px) {
      .admin-sidebar {
        position: fixed; ${rtl ? "right" : "left"}: 0; top: 0; z-index: 50;
        transform: translate${rtl ? "X(100%)" : "X(-100%)"};
        transition: transform .25s;
      }
      .admin-sidebar.open { transform: translateX(0); }
      .sidebar-close { display: block; }
    }
    @media (min-width: 769px) { .sidebar-toggle { display: none; } }

    /* Island mount targets */
    .island-root { min-height: 60px; }

    /* Section headers */
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .section-header h2 { font-size: 20px; font-weight: 600; }

    /* Login page */
    .login-body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; width: 100%; max-width: 360px; }
    .login-header { text-align: center; margin-bottom: 24px; }
    .login-header h1 { font-size: 28px; margin-bottom: 4px; }
    .login-header p { color: var(--text-muted); font-size: 14px; }

    ${rtl ? `
    /* RTL adjustments */
    .admin-topbar { flex-direction: row-reverse; }
    .nav-item { flex-direction: row-reverse; }
    ` : ""}
  `;
}
