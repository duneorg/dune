/**
 * Admin server — handles all /admin/* requests.
 *
 * Routes:
 *   GET  /admin/              → Dashboard (or redirect to login)
 *   GET  /admin/login         → Login page
 *   POST /admin/login         → Authenticate
 *   POST /admin/logout        → Clear session
 *   GET  /admin/api/dashboard → Dashboard data (JSON)
 *   GET  /admin/api/pages     → List pages (JSON)
 *   POST /admin/api/pages     → Create page
 *   PUT  /admin/api/pages/:path → Update page
 *   DELETE /admin/api/pages/:path → Delete page
 *   GET  /admin/api/users     → List users (admin only)
 *   POST /admin/api/users     → Create user (admin only)
 *   GET  /admin/api/config    → Read config (JSON)
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

    // GET /admin/pages — Page management
    if (adminPath === "/pages") {
      return htmlResponse(renderShellPage(prefix, "pages", authResult));
    }

    // GET /admin/media — Media library
    if (adminPath === "/media") {
      return htmlResponse(renderShellPage(prefix, "media", authResult));
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
        })),
        total: engine.pages.length,
      });
    }

    // POST /admin/api/pages — Create a new page
    if (adminPath === "/api/pages" && method === "POST") {
      requirePermission(authResult, "pages.create");
      return handleCreatePage(req);
    }

    // PUT /admin/api/pages/* — Update a page
    if (adminPath.startsWith("/api/pages/") && method === "PUT") {
      requirePermission(authResult, "pages.update");
      const pagePath = adminPath.replace("/api/pages/", "");
      return handleUpdatePage(req, pagePath);
    }

    // DELETE /admin/api/pages/* — Delete a page
    if (adminPath.startsWith("/api/pages/") && method === "DELETE") {
      requirePermission(authResult, "pages.delete");
      const pagePath = adminPath.replace("/api/pages/", "");
      return handleDeletePage(pagePath);
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

      // Find the page by route
      const page = engine.pages.find((p) => p.sourcePath.includes(pagePath));
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
      const page = engine.pages.find((p) => p.sourcePath.includes(pagePath));
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
