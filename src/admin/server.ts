/**
 * Admin server — handles all /admin/* requests.
 *
 * Routes:
 *   GET  /admin/              → Dashboard (or redirect to login)
 *   GET  /admin/login         → Login page
 *   POST /admin/login         → Authenticate
 *   POST /admin/logout        → Clear session
 *   GET  /admin/pages         → Page tree
 *   GET  /admin/pages/edit    → Page editor
 *   GET  /admin/media         → Media library
 *   GET  /admin/users         → User management
 *   GET  /admin/api/dashboard → Dashboard data (JSON)
 *   GET  /admin/api/pages     → List pages (JSON)
 *   GET  /admin/api/pages/:path → Get single page (JSON)
 *   POST /admin/api/pages     → Create page
 *   PUT  /admin/api/pages/:path → Update page
 *   DELETE /admin/api/pages/:path → Delete page
 *   GET  /admin/api/media     → List all media (JSON)
 *   GET  /admin/api/users     → List users (admin only)
 *   POST /admin/api/users     → Create user (admin only)
 *   GET  /admin/api/config    → Read config (JSON)
 *   POST /admin/api/editor/parse     → Markdown → Blocks
 *   POST /admin/api/editor/serialize → Blocks → Markdown
 *   POST /admin/api/preview   → Render preview HTML
 */

import type { DuneEngine } from "../core/engine.ts";
import type { AuthMiddleware } from "./auth/middleware.ts";
import type { UserManager } from "./auth/users.ts";
import type { SessionManager } from "./auth/sessions.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { AdminPermission, AuthResult } from "./types.ts";
import { toUserInfo } from "./types.ts";
import { verifyPassword } from "./auth/passwords.ts";
import { renderLoginPage, renderDashboardPage, renderShellPage } from "./ui/pages.ts";
import { renderPageTree } from "./ui/page-tree.ts";
import { renderPageEditorPage } from "./ui/page-editor.ts";
import { renderMediaLibrary } from "./ui/media-library.ts";
import { markdownToBlocks, blocksToMarkdown } from "./editor/serializer.ts";

export interface AdminServerConfig {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  auth: AuthMiddleware;
  users: UserManager;
  sessions: SessionManager;
  /** Admin route prefix (e.g. "/admin") */
  prefix: string;
}

/**
 * Create the admin request handler.
 * Returns null if the request is not for an admin route.
 */
export function createAdminHandler(config: AdminServerConfig) {
  const { engine, storage, auth, users, sessions, prefix } = config;
  const adminConfig = config.config.admin!;

  return async function handleAdminRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Only handle admin routes
    if (!path.startsWith(prefix)) return null;

    // Strip prefix to get the admin-relative path
    const adminPath = path.slice(prefix.length) || "/";

    // === Public routes (no auth required) ===

    // GET /admin/login
    if (adminPath === "/login" && req.method === "GET") {
      return htmlResponse(renderLoginPage(prefix));
    }

    // POST /admin/login
    if (adminPath === "/login" && req.method === "POST") {
      return handleLogin(req);
    }

    // === Auth-protected routes ===
    const authResult = await auth.authenticate(req);

    // POST /admin/logout (needs valid session)
    if (adminPath === "/logout" && req.method === "POST") {
      if (authResult.session) {
        await sessions.revoke(authResult.session.id);
      }
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${prefix}/login`,
          "Set-Cookie": auth.clearSessionCookie(),
        },
      });
    }

    // All other routes require authentication
    if (!authResult.authenticated) {
      // API routes return 401 JSON
      if (adminPath.startsWith("/api/")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      // UI routes redirect to login
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/login` },
      });
    }

    // === Admin API routes ===

    if (adminPath.startsWith("/api/")) {
      return handleAdminApi(adminPath, req, authResult);
    }

    // === Admin UI routes ===

    // GET /admin/ — Dashboard
    if (adminPath === "/" || adminPath === "") {
      return htmlResponse(renderDashboardPage(prefix, engine, authResult));
    }

    // GET /admin/pages/edit?path=... — Page editor
    if (adminPath === "/pages/edit" && req.method === "GET") {
      return handlePageEditor(url, authResult);
    }

    // GET /admin/pages — Page tree
    if (adminPath === "/pages") {
      return htmlResponse(renderPageTreePage(prefix, authResult));
    }

    // GET /admin/media — Media library
    if (adminPath === "/media") {
      return htmlResponse(renderMediaLibraryPage(prefix, authResult));
    }

    // GET /admin/users — User management
    if (adminPath === "/users") {
      if (!auth.hasPermission(authResult, "users.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return htmlResponse(renderShellPage(prefix, "users", authResult));
    }

    return new Response("Not found", { status: 404 });
  };

  // === Login handler ===

  async function handleLogin(req: Request): Promise<Response> {
    try {
      const formData = await req.formData();
      const username = formData.get("username") as string;
      const password = formData.get("password") as string;

      if (!username || !password) {
        return htmlResponse(renderLoginPage(prefix, "Username and password required"), 400);
      }

      const user = await users.getByUsername(username);
      if (!user || !user.enabled) {
        return htmlResponse(renderLoginPage(prefix, "Invalid credentials"), 401);
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return htmlResponse(renderLoginPage(prefix, "Invalid credentials"), 401);
      }

      // Create session
      const ip = req.headers.get("x-forwarded-for") ?? undefined;
      const session = await sessions.create(user.id, ip);

      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${prefix}/`,
          "Set-Cookie": auth.createSessionCookie(session.id, adminConfig.sessionLifetime),
        },
      });
    } catch {
      return htmlResponse(renderLoginPage(prefix, "Login error"), 500);
    }
  }

  // === Page editor handler ===

  async function handlePageEditor(url: URL, authResult: AuthResult): Promise<Response> {
    const sourcePath = url.searchParams.get("path");
    if (!sourcePath) {
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/pages` },
      });
    }

    try {
      const page = await engine.loadPage(sourcePath);
      const userName = authResult.user?.name ?? "Admin";

      return htmlResponse(renderPageEditorPage(prefix, userName, {
        sourcePath: page.sourcePath,
        route: page.route,
        title: page.frontmatter.title ?? "",
        format: page.format,
        template: page.template,
        published: page.frontmatter.published !== false,
        rawContent: page.rawContent,
        frontmatter: page.frontmatter as Record<string, unknown>,
        media: page.media.map((m) => ({
          name: m.name,
          url: m.url,
          type: m.type,
          size: m.size,
        })),
      }));
    } catch (err) {
      return htmlResponse(`<h1>Page not found</h1><p>${escapeHtml(String(err))}</p>`, 404);
    }
  }

  // === Page tree page ===

  function renderPageTreePage(pfx: string, authResult: AuthResult): string {
    const userName = authResult.user?.name ?? "Admin";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pages — Dune Admin</title>
  <style>${pageTreeStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "pages", userName, `
    <h2>Pages</h2>
    ${renderPageTree(engine.pages, pfx)}
  `)}
</body>
</html>`;
  }

  // === Media library page ===

  function renderMediaLibraryPage(pfx: string, authResult: AuthResult): string {
    const userName = authResult.user?.name ?? "Admin";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Media — Dune Admin</title>
  <style>${mediaLibraryStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "media", userName, `
    <h2>Media Library</h2>
    ${renderMediaLibrary(pfx)}
  `)}
</body>
</html>`;
  }

  // === Admin API router ===

  async function handleAdminApi(
    adminPath: string,
    req: Request,
    authResult: AuthResult,
  ): Promise<Response> {
    const method = req.method;

    // GET /admin/api/dashboard
    if (adminPath === "/api/dashboard" && method === "GET") {
      return jsonResponse({
        pages: {
          total: engine.pages.length,
          published: engine.pages.filter((p) => p.published).length,
          draft: engine.pages.filter((p) => !p.published).length,
        },
        formats: {
          md: engine.pages.filter((p) => p.format === "md").length,
          mdx: engine.pages.filter((p) => p.format === "mdx").length,
          tsx: engine.pages.filter((p) => p.format === "tsx").length,
        },
        user: authResult.user ? toUserInfo(authResult.user) : null,
      });
    }

    // GET /admin/api/pages — List pages for admin
    if (adminPath === "/api/pages" && method === "GET") {
      requirePermission(authResult, "pages.read");
      return jsonResponse({
        items: engine.pages.map((p) => ({
          route: p.route,
          title: p.title,
          sourcePath: p.sourcePath,
          format: p.format,
          template: p.template,
          published: p.published,
          date: p.date,
          order: p.order,
          depth: p.depth,
          parentPath: p.parentPath,
          isModule: p.isModule,
        })),
        total: engine.pages.length,
      });
    }

    // GET /admin/api/pages/:path — Get single page with content
    if (adminPath.startsWith("/api/pages/") && method === "GET") {
      requirePermission(authResult, "pages.read");
      const pagePath = decodeURIComponent(adminPath.replace("/api/pages/", ""));
      return handleGetPage(pagePath);
    }

    // POST /admin/api/pages — Create a new page
    if (adminPath === "/api/pages" && method === "POST") {
      requirePermission(authResult, "pages.create");
      return handleCreatePage(req);
    }

    // PUT /admin/api/pages/* — Update a page
    if (adminPath.startsWith("/api/pages/") && method === "PUT") {
      requirePermission(authResult, "pages.update");
      const pagePath = decodeURIComponent(adminPath.replace("/api/pages/", ""));
      return handleUpdatePage(req, pagePath);
    }

    // DELETE /admin/api/pages/* — Delete a page
    if (adminPath.startsWith("/api/pages/") && method === "DELETE") {
      requirePermission(authResult, "pages.delete");
      const pagePath = decodeURIComponent(adminPath.replace("/api/pages/", ""));
      return handleDeletePage(pagePath);
    }

    // GET /admin/api/media — List all media files across all pages
    if (adminPath === "/api/media" && method === "GET") {
      requirePermission(authResult, "media.read");
      return handleListMedia();
    }

    // POST /admin/api/editor/parse — Markdown → Blocks
    if (adminPath === "/api/editor/parse" && method === "POST") {
      return handleEditorParse(req);
    }

    // POST /admin/api/editor/serialize — Blocks → Markdown
    if (adminPath === "/api/editor/serialize" && method === "POST") {
      return handleEditorSerialize(req);
    }

    // POST /admin/api/preview — Render preview HTML
    if (adminPath === "/api/preview" && method === "POST") {
      requirePermission(authResult, "pages.read");
      return handlePreview(req);
    }

    // GET /admin/api/users — List users
    if (adminPath === "/api/users" && method === "GET") {
      requirePermission(authResult, "users.read");
      const allUsers = await users.list();
      return jsonResponse({
        items: allUsers.map(toUserInfo),
        total: allUsers.length,
      });
    }

    // POST /admin/api/users — Create user
    if (adminPath === "/api/users" && method === "POST") {
      requirePermission(authResult, "users.create");
      return handleCreateUser(req);
    }

    // GET /admin/api/config — Read site config
    if (adminPath === "/api/config" && method === "GET") {
      requirePermission(authResult, "config.read");
      const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
      return jsonResponse({ title, description, url: siteUrl, author, metadata, taxonomies });
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  // === Page CRUD handlers ===

  async function handleGetPage(pagePath: string): Promise<Response> {
    try {
      const pageIndex = engine.pages.find((p) =>
        p.sourcePath === pagePath || p.sourcePath.includes(pagePath)
      );
      if (!pageIndex) {
        return jsonResponse({ error: "Page not found" }, 404);
      }

      const page = await engine.loadPage(pageIndex.sourcePath);
      return jsonResponse({
        sourcePath: page.sourcePath,
        route: page.route,
        format: page.format,
        template: page.template,
        frontmatter: page.frontmatter,
        rawContent: page.rawContent,
        media: page.media.map((m) => ({
          name: m.name,
          url: m.url,
          type: m.type,
          size: m.size,
        })),
      });
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  async function handleCreatePage(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { path: pagePath, title, content, template, format } = body;

      if (!pagePath || !title) {
        return jsonResponse({ error: "path and title are required" }, 400);
      }

      const ext = format === "mdx" ? ".mdx" : format === "tsx" ? ".tsx" : ".md";
      const frontmatter = `---\ntitle: "${title}"\ntemplate: ${template ?? "default"}\npublished: true\n---\n`;
      const fullContent = frontmatter + "\n" + (content ?? "");

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${pagePath}/default${ext}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));

      // Rebuild the engine
      await engine.rebuild();

      return jsonResponse({ created: true, path: pagePath, file: filePath }, 201);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  async function handleUpdatePage(req: Request, pagePath: string): Promise<Response> {
    try {
      const body = await req.json();
      const { content, frontmatter: fm } = body;

      // Find the page by source path
      const page = engine.pages.find((p) =>
        p.sourcePath === pagePath || p.sourcePath.includes(pagePath)
      );
      if (!page) {
        return jsonResponse({ error: "Page not found" }, 404);
      }

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${page.sourcePath}`;

      // Read existing content
      const existing = await storage.read(filePath);
      let raw = new TextDecoder().decode(existing);

      // Update frontmatter if provided
      if (fm) {
        const yamlFm = Object.entries(fm)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n");
        raw = raw.replace(/^---[\s\S]*?---/, `---\n${yamlFm}\n---`);
      }

      // Update content body if provided
      if (content !== undefined) {
        const fmMatch = raw.match(/^---[\s\S]*?---\n*/);
        const fmPart = fmMatch ? fmMatch[0] : "";
        raw = fmPart + content;
      }

      await storage.write(filePath, new TextEncoder().encode(raw));
      await engine.rebuild();

      return jsonResponse({ updated: true, sourcePath: page.sourcePath });
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  async function handleDeletePage(pagePath: string): Promise<Response> {
    try {
      const page = engine.pages.find((p) =>
        p.sourcePath === pagePath || p.sourcePath.includes(pagePath)
      );
      if (!page) {
        return jsonResponse({ error: "Page not found" }, 404);
      }

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${page.sourcePath}`;

      await storage.delete(filePath);
      await engine.rebuild();

      return jsonResponse({ deleted: true, sourcePath: page.sourcePath });
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  // === Media listing handler ===

  async function handleListMedia(): Promise<Response> {
    try {
      const items: Array<{
        name: string;
        url: string;
        type: string;
        size: number;
        pagePath: string;
      }> = [];

      // Load media from all pages
      for (const pageIndex of engine.pages) {
        try {
          const page = await engine.loadPage(pageIndex.sourcePath);
          for (const media of page.media) {
            items.push({
              name: media.name,
              url: media.url,
              type: media.type,
              size: media.size,
              pagePath: pageIndex.sourcePath,
            });
          }
        } catch {
          // Skip pages that can't be loaded
        }
      }

      return jsonResponse({ items, total: items.length });
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  // === Editor API handlers ===

  async function handleEditorParse(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { content } = body;

      if (typeof content !== "string") {
        return jsonResponse({ error: "content string required" }, 400);
      }

      const doc = markdownToBlocks(content);
      return jsonResponse(doc);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  async function handleEditorSerialize(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { blocks } = body;

      if (!Array.isArray(blocks)) {
        return jsonResponse({ error: "blocks array required" }, 400);
      }

      const markdown = blocksToMarkdown(blocks);
      return jsonResponse({ markdown });
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  // === Preview handler ===

  async function handlePreview(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { sourcePath, content, frontmatter: fm } = body;

      if (!sourcePath) {
        return jsonResponse({ error: "sourcePath required" }, 400);
      }

      // Find the page
      const pageIndex = engine.pages.find((p) =>
        p.sourcePath === sourcePath || p.sourcePath.includes(sourcePath)
      );

      if (!pageIndex) {
        // Render content directly without theme
        return htmlResponse(`<!DOCTYPE html>
<html><head><style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto;}</style></head>
<body>${content ?? ""}</body></html>`);
      }

      // Load the page and render preview with the theme template
      const page = await engine.loadPage(pageIndex.sourcePath);
      const html = await page.html();

      return htmlResponse(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;}img{max-width:100%;}pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto;}code{background:#f0f0f0;padding:0.1em 0.3em;border-radius:2px;}blockquote{border-left:3px solid #ccc;padding-left:1rem;color:#666;margin:1rem 0;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:0.5rem;}</style></head>
<body>${html}</body></html>`);
    } catch (err) {
      return htmlResponse(`<h1>Preview Error</h1><pre>${escapeHtml(String(err))}</pre>`, 500);
    }
  }

  // === User creation handler ===

  async function handleCreateUser(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { username, email, password, role, name } = body;

      if (!username || !password || !role) {
        return jsonResponse({ error: "username, password, and role are required" }, 400);
      }

      // Check for duplicate username
      const existing = await users.getByUsername(username);
      if (existing) {
        return jsonResponse({ error: "Username already exists" }, 409);
      }

      const user = await users.create({
        username,
        email: email ?? "",
        password,
        role,
        name: name ?? username,
      });

      return jsonResponse({ created: true, user: toUserInfo(user) }, 201);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  function requirePermission(authResult: AuthResult, permission: AdminPermission): void {
    if (!auth.hasPermission(authResult, permission)) {
      throw new PermissionError(permission);
    }
  }
}

class PermissionError extends Error {
  constructor(permission: string) {
    super(`Permission denied: ${permission}`);
  }
}

// === Admin shell (sidebar + top bar) — shared across pages ===

function adminShell(prefix: string, active: string, userName: string, content: string): string {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "📊", href: `${prefix}/` },
    { id: "pages", label: "Pages", icon: "📄", href: `${prefix}/pages` },
    { id: "media", label: "Media", icon: "🖼️", href: `${prefix}/media` },
    { id: "users", label: "Users", icon: "👥", href: `${prefix}/users` },
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

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// === Styles ===

function pageTreeStyles(): string {
  return baseAdminStyles() + `
  /* Page tree */
  .page-tree-toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; }
  .tree-search { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; }
  .page-tree { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .tree-node { }
  .tree-row { display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.5rem; border-bottom: 1px solid #f0f0f0; transition: background 0.1s; }
  .tree-row:hover { background: #fafafa; }
  .tree-toggle { background: none; border: none; cursor: pointer; font-size: 0.7rem; color: #999; width: 16px; padding: 0; }
  .tree-toggle-spacer { width: 16px; flex-shrink: 0; }
  .tree-icon { font-size: 0.9rem; }
  .tree-title { flex: 1; color: #333; text-decoration: none; font-size: 0.9rem; }
  .tree-title:hover { color: #c9a96e; }
  .tree-meta { display: flex; gap: 0.25rem; }
  .tree-route { color: #999; font-size: 0.75rem; font-family: monospace; }
  .tree-actions { display: flex; gap: 0.15rem; opacity: 0; transition: opacity 0.15s; }
  .tree-row:hover .tree-actions { opacity: 1; }
  .tree-children { }
  .modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .modal-content { position: relative; background: #fff; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-content h3 { margin-bottom: 1rem; }
  .modal-wide { max-width: 640px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .form-actions .btn-outline { color: #666; border-color: #ddd; }
  small { display: block; margin-top: 0.15rem; color: #999; font-size: 0.75rem; }
  `;
}

function mediaLibraryStyles(): string {
  return baseAdminStyles() + `
  /* Media library */
  .media-toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; }
  .media-search { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; }
  .media-count { color: #999; font-size: 0.85rem; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
  .media-card { background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); cursor: pointer; transition: box-shadow 0.15s; }
  .media-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .media-card-preview { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #f8f8f8; overflow: hidden; }
  .media-card-preview img { width: 100%; height: 100%; object-fit: cover; }
  .media-card-icon { font-size: 2.5rem; }
  .media-card-info { padding: 0.4rem 0.5rem; }
  .media-card-name { display: block; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media-card-meta { display: block; font-size: 0.7rem; color: #999; }
  .media-empty { text-align: center; color: #999; padding: 2rem; }
  .media-detail { display: flex; gap: 1rem; margin-bottom: 1rem; }
  .media-detail-preview { flex: 1; }
  .media-detail-preview img { max-width: 100%; border-radius: 4px; }
  .detail-icon { font-size: 4rem; text-align: center; padding: 2rem; }
  .media-detail-info { flex: 1; }
  .media-detail-info h4 { margin-bottom: 0.5rem; }
  .detail-row { font-size: 0.85rem; color: #666; margin-bottom: 0.25rem; }
  .detail-row code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 2px; font-size: 0.8rem; }
  .modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .modal-content { position: relative; background: #fff; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 640px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-wide { max-width: 640px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .form-actions .btn-outline { color: #666; border-color: #ddd; }
  `;
}

function baseAdminStyles(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #333; }
  .admin-layout { display: flex; min-height: 100vh; }
  .admin-sidebar { width: 240px; background: #1a1a2e; color: #ccc; flex-shrink: 0; }
  .sidebar-brand { padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .sidebar-brand a { color: #fff; text-decoration: none; font-size: 1.25rem; font-weight: 700; }
  .sidebar-nav { padding: 0.5rem 0; }
  .nav-item { display: flex; align-items: center; padding: 0.65rem 1.25rem; color: #aaa; text-decoration: none; font-size: 0.9rem; transition: all 0.15s; }
  .nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
  .nav-item.active { color: #c9a96e; background: rgba(201,169,110,0.1); border-right: 3px solid #c9a96e; }
  .nav-icon { margin-right: 0.75rem; font-size: 1.1rem; }
  .admin-main { flex: 1; display: flex; flex-direction: column; }
  .admin-topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: #fff; border-bottom: 1px solid #e0e0e0; }
  .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
  .user-name { color: #666; font-size: 0.85rem; }
  .admin-content { padding: 1.5rem; flex: 1; }
  .btn { display: inline-block; padding: 0.5rem 1rem; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; text-decoration: none; color: inherit; }
  .btn-primary { background: #c9a96e; color: #fff; font-weight: 600; }
  .btn-primary:hover { background: #b8944f; }
  .btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
  .btn-xs { padding: 0.15rem 0.4rem; font-size: 0.75rem; }
  .btn-outline { background: transparent; border: 1px solid #ddd; color: #666; }
  .btn-outline:hover { background: #f0f0f0; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge-md { background: #e8f4f8; color: #1a7a9b; }
  .badge-mdx { background: #f0e8f8; color: #7a1a9b; }
  .badge-tsx { background: #e8f8e8; color: #1a7a3b; }
  .badge-draft { background: #fff3cd; color: #856404; }
  .form-group { margin-bottom: 0.75rem; }
  .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.85rem; color: #555; }
  .form-group input, .form-group select { width: 100%; padding: 0.5rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #c9a96e; box-shadow: 0 0 0 3px rgba(201,169,110,0.2); }
  h2 { margin-bottom: 1rem; color: #1a1a2e; }
  `;
}
