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
 *
 * Public routes (no admin auth):
 *   POST /api/contact         → Accept contact form submissions
 */

import { stringify as stringifyYaml } from "@std/yaml";
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
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { HistoryEngine } from "../history/engine.ts";
import { renderRevisionHistory, renderRevisionScripts, revisionHistoryStyles } from "./ui/revision-history.ts";
import { renderTranslationStatus, translationStatusStyles } from "./ui/translation-status.ts";
import { renderWorkflowPanel, workflowPanelStyles } from "./ui/workflow-panel.ts";
import type { SubmissionManager, SubmissionStatus } from "./submissions.ts";
import {
  renderSubmissionsList,
  renderSubmissionDetail,
  submissionStyles,
} from "./ui/submissions.ts";

export interface AdminServerConfig {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  auth: AuthMiddleware;
  users: UserManager;
  sessions: SessionManager;
  /** Admin route prefix (e.g. "/admin") */
  prefix: string;
  workflow?: WorkflowEngine;
  scheduler?: Scheduler;
  history?: HistoryEngine;
  submissions?: SubmissionManager;
}

// === In-memory rate limiter ===
// Keyed by IP address (or any string bucket). Not shared across processes —
// sufficient for single-instance deployments; upgrade to KV-backed limiting
// for multi-instance production if needed.

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the key is within the allowed rate, false if limited. */
  check(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= this.maxRequests) {
      return false; // rate limited
    }

    bucket.count++;
    return true;
  }

  /** Returns the number of seconds until the window resets for a key. */
  retryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.ceil(Math.max(0, bucket.resetAt - Date.now()) / 1000);
  }
}

/**
 * Create the admin request handler.
 * Returns null if the request is not for an admin route.
 */
// Rate limiter for login: 5 attempts per 15 minutes per IP
const loginRateLimiter = new RateLimiter(5, 15 * 60 * 1000);

// Rate limiter for public contact form: 5 submissions per minute per IP
const contactRateLimiter = new RateLimiter(5, 60 * 1000);

export function createAdminHandler(config: AdminServerConfig) {
  const { engine, storage, auth, users, sessions, prefix, workflow, scheduler, history, submissions } = config;
  const adminConfig = config.config.admin!;

  // Sanity-check the prefix at startup.  A prefix that doesn't start with "/"
  // causes path.startsWith(prefix) to match unintended routes or fail silently.
  if (!prefix.startsWith("/")) {
    throw new Error(`Admin prefix must start with "/" — got: ${JSON.stringify(prefix)}`);
  }

  return async function handleAdminRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    // === Public contact form endpoint ===
    // POST /api/contact — accepts contact form data, no admin auth required
    if (path === "/api/contact" && req.method === "POST") {
      return handleContactSubmission(req);
    }

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
      try {
        return await handleAdminApi(adminPath, req, authResult);
      } catch (err) {
        if (err instanceof PermissionError) {
          return jsonResponse({ error: err.message }, 403);
        }
        throw err;
      }
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

    // GET /admin/pages/history?path=... — Revision history
    if (adminPath === "/pages/history" && req.method === "GET") {
      return handleRevisionHistoryPage(url, authResult);
    }

    // GET /admin/i18n — Translation status
    if (adminPath === "/i18n") {
      return htmlResponse(renderI18nPage(prefix, authResult));
    }

    // GET /admin/users — User management
    if (adminPath === "/users") {
      if (!auth.hasPermission(authResult, "users.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return htmlResponse(renderShellPage(prefix, "users", authResult));
    }

    // GET /admin/submissions — submissions index (redirect to first form or show all forms)
    if (adminPath === "/submissions") {
      if (!auth.hasPermission(authResult, "submissions.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return handleSubmissionsIndex(authResult);
    }

    // GET /admin/submissions/:form — list submissions for a form
    if (adminPath.startsWith("/submissions/") && adminPath.split("/").length === 3) {
      if (!auth.hasPermission(authResult, "submissions.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      const form = decodeURIComponent(adminPath.split("/")[2]);
      return handleSubmissionsListPage(form, authResult);
    }

    // GET /admin/submissions/:form/:id — single submission detail
    if (adminPath.startsWith("/submissions/") && adminPath.split("/").length === 4) {
      if (!auth.hasPermission(authResult, "submissions.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      const parts = adminPath.split("/");
      const form = decodeURIComponent(parts[2]);
      const id = parts[3];
      return handleSubmissionDetailPage(form, id, authResult);
    }

    // POST /admin/submissions/:form/:id/status — update submission status
    if (adminPath.startsWith("/submissions/") && adminPath.endsWith("/status") && req.method === "POST") {
      if (!auth.hasPermission(authResult, "submissions.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      const parts = adminPath.split("/");
      const form = decodeURIComponent(parts[2]);
      const id = parts[3];
      return handleSubmissionStatusUpdate(req, form, id);
    }

    // POST /admin/submissions/:form/:id/delete — delete submission
    if (adminPath.startsWith("/submissions/") && adminPath.endsWith("/delete") && req.method === "POST") {
      if (!auth.hasPermission(authResult, "submissions.delete")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      const parts = adminPath.split("/");
      const form = decodeURIComponent(parts[2]);
      const id = parts[3];
      return handleSubmissionDelete(form, id);
    }

    return new Response("Not found", { status: 404 });
  };

  // === Login handler ===

  async function handleLogin(req: Request): Promise<Response> {
    try {
      // Rate limit by IP: 5 failed attempts per 15-minute window
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
        ?? req.headers.get("x-real-ip")
        ?? "unknown";
      if (!loginRateLimiter.check(ip)) {
        const retryAfter = loginRateLimiter.retryAfter(ip);
        return htmlResponse(
          renderLoginPage(prefix, `Too many login attempts. Try again in ${retryAfter} seconds.`),
          429,
        );
      }

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

      // Create session (reuse ip from rate limiting above)
      const session = await sessions.create(user.id, ip === "unknown" ? undefined : ip);

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

    // CSRF protection: reject state-mutating requests that carry a cross-origin
    // Origin header. Browsers always send Origin on cross-site requests, so a
    // mismatch means the request was initiated by a different origin.
    // Requests with no Origin header (e.g. direct API calls or same-origin form
    // POSTs in some browsers) are allowed — SameSite=Lax on the session cookie
    // provides the second layer of protection.
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const requestOrigin = new URL(req.url).origin;
      const origin = req.headers.get("origin");
      if (origin !== null && origin !== requestOrigin) {
        return jsonResponse({ error: "Forbidden: cross-origin request rejected" }, 403);
      }
    }

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
      return handleCreateUser(req, authResult);
    }

    // GET /admin/api/config — Read site config
    if (adminPath === "/api/config" && method === "GET") {
      requirePermission(authResult, "config.read");
      const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
      return jsonResponse({ title, description, url: siteUrl, author, metadata, taxonomies });
    }

    // === Workflow API routes ===

    // POST /admin/api/workflow/transition — Change page status
    if (adminPath === "/api/workflow/transition" && method === "POST") {
      requirePermission(authResult, "pages.update");
      return handleWorkflowTransition(req);
    }

    // GET /admin/api/workflow/status/:path — Get workflow status
    if (adminPath.startsWith("/api/workflow/status/") && method === "GET") {
      requirePermission(authResult, "pages.read");
      const pagePath = decodeURIComponent(adminPath.replace("/api/workflow/status/", ""));
      return handleGetWorkflowStatus(pagePath);
    }

    // POST /admin/api/workflow/schedule — Schedule an action
    if (adminPath === "/api/workflow/schedule" && method === "POST") {
      requirePermission(authResult, "pages.update");
      return handleScheduleAction(req, authResult);
    }

    // DELETE /admin/api/workflow/schedule/:id — Cancel scheduled action
    if (adminPath.startsWith("/api/workflow/schedule/") && method === "DELETE") {
      requirePermission(authResult, "pages.update");
      const actionId = adminPath.replace("/api/workflow/schedule/", "");
      return handleCancelSchedule(actionId);
    }

    // GET /admin/api/workflow/scheduled/:path — List scheduled actions
    if (adminPath.startsWith("/api/workflow/scheduled/") && method === "GET") {
      requirePermission(authResult, "pages.read");
      const pagePath = decodeURIComponent(adminPath.replace("/api/workflow/scheduled/", ""));
      return handleListScheduled(pagePath);
    }

    // === History API routes ===

    // GET /admin/api/history/:path — List revisions
    if (adminPath.startsWith("/api/history/") && method === "GET" && !adminPath.includes("/diff")) {
      requirePermission(authResult, "pages.read");
      const rest = adminPath.replace("/api/history/", "");
      const parts = rest.split("/");
      const pagePath = decodeURIComponent(parts[0]);

      if (parts.length === 2 && parts[1]) {
        // GET /admin/api/history/:path/:revNum — Get specific revision
        const revNum = parseInt(parts[1], 10);
        return handleGetRevision(pagePath, revNum);
      }

      return handleGetHistory(pagePath);
    }

    // GET /admin/api/history/:path/:revNum/diff — Diff revision vs current
    if (adminPath.startsWith("/api/history/") && method === "GET" && adminPath.endsWith("/diff")) {
      requirePermission(authResult, "pages.read");
      const rest = adminPath.replace("/api/history/", "").replace("/diff", "");
      const parts = rest.split("/");
      const pagePath = decodeURIComponent(parts[0]);
      const revNum = parseInt(parts[1], 10);
      return handleDiffRevision(pagePath, revNum);
    }

    // POST /admin/api/history/:path/:revNum/restore — Restore a revision
    if (adminPath.startsWith("/api/history/") && method === "POST" && adminPath.endsWith("/restore")) {
      requirePermission(authResult, "pages.update");
      const rest = adminPath.replace("/api/history/", "").replace("/restore", "");
      const parts = rest.split("/");
      const pagePath = decodeURIComponent(parts[0]);
      const revNum = parseInt(parts[1], 10);
      return handleRestoreRevision(pagePath, revNum);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  // === Page CRUD handlers ===

  async function handleGetPage(pagePath: string): Promise<Response> {
    try {
      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
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
      return serverError(err);
    }
  }

  async function handleCreatePage(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { path: pagePath, title, content, template, format } = body;

      if (!pagePath || !title) {
        return jsonResponse({ error: "path and title are required" }, 400);
      }

      if (!validatePagePath(pagePath)) {
        return jsonResponse({ error: "Invalid page path: must not contain '..' or absolute segments" }, 400);
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
      return serverError(err);
    }
  }

  async function handleUpdatePage(req: Request, pagePath: string): Promise<Response> {
    try {
      const body = await req.json();
      const { content, frontmatter: fm } = body;

      // Find the page by source path (exact match — no fuzzy includes())
      const page = engine.pages.find((p) => p.sourcePath === pagePath);
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
        // Use @std/yaml stringify to safely serialize frontmatter — prevents
        // YAML injection that was possible with the previous string-concat approach.
        const yamlFm = stringifyYaml(fm).trimEnd();
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
      return serverError(err);
    }
  }

  async function handleDeletePage(pagePath: string): Promise<Response> {
    try {
      const page = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!page) {
        return jsonResponse({ error: "Page not found" }, 404);
      }

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${page.sourcePath}`;

      await storage.delete(filePath);
      await engine.rebuild();

      return jsonResponse({ deleted: true, sourcePath: page.sourcePath });
    } catch (err) {
      return serverError(err);
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
      return serverError(err);
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
      return serverError(err);
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
      return serverError(err);
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
      return serverErrorHtml(err, "preview");
    }
  }

  // === User creation handler ===

  async function handleCreateUser(req: Request, authResult: AuthResult): Promise<Response> {
    try {
      const body = await req.json();
      const { username, email, password, role, name } = body;

      if (!username || !password || !role) {
        return jsonResponse({ error: "username, password, and role are required" }, 400);
      }

      // Enforce minimum password length.
      const MIN_PASSWORD_LENGTH = 12;
      if (password.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      }

      // Validate role against the known set to prevent privilege escalation.
      const VALID_ROLES = ["admin", "editor", "author"] as const;
      if (!VALID_ROLES.includes(role)) {
        return jsonResponse({ error: `Invalid role: must be one of ${VALID_ROLES.join(", ")}` }, 400);
      }

      // Only admins may create other admin accounts.
      if (role === "admin" && authResult.user?.role !== "admin") {
        return jsonResponse({ error: "Only admins can create admin-role users" }, 403);
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
      return serverError(err);
    }
  }

  // === Workflow handlers ===

  async function handleWorkflowTransition(req: Request): Promise<Response> {
    if (!workflow) return jsonResponse({ error: "Workflow not enabled" }, 501);
    try {
      const body = await req.json();
      const { sourcePath, status: newStatus } = body;
      if (!sourcePath || !newStatus) {
        return jsonResponse({ error: "sourcePath and status are required" }, 400);
      }

      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

      const currentStatus = workflow.getStatus(pageIndex);
      if (!workflow.canTransition(currentStatus, newStatus)) {
        return jsonResponse({ error: `Cannot transition from ${currentStatus} to ${newStatus}` }, 400);
      }

      // Update frontmatter with new status
      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      const raw = new TextDecoder().decode(await storage.read(filePath));

      let updated: string;
      if (raw.match(/^status:\s*.+$/m)) {
        updated = raw.replace(/^status:\s*.+$/m, `status: ${newStatus}`);
      } else {
        // Add status after the opening ---
        updated = raw.replace(/^---\n/, `---\nstatus: ${newStatus}\n`);
      }

      // Also update published flag based on status
      if (newStatus === "published") {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: true");
        }
      } else if (newStatus === "draft" || newStatus === "archived") {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: false");
        }
      }

      await storage.write(filePath, new TextEncoder().encode(updated));
      await engine.rebuild();

      return jsonResponse({ transitioned: true, from: currentStatus, to: newStatus });
    } catch (err) {
      return serverError(err);
    }
  }

  function handleGetWorkflowStatus(pagePath: string): Response {
    if (!workflow) return jsonResponse({ error: "Workflow not enabled" }, 501);
    const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
    if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

    const status = workflow.getStatus(pageIndex);
    const allowed = workflow.allowedTransitions(status);
    return jsonResponse({ sourcePath: pagePath, status, allowedTransitions: allowed });
  }

  async function handleScheduleAction(req: Request, authResult: AuthResult): Promise<Response> {
    if (!scheduler) return jsonResponse({ error: "Scheduler not enabled" }, 501);
    try {
      const body = await req.json();
      const { sourcePath, action, scheduledAt } = body;
      if (!sourcePath || !action || !scheduledAt) {
        return jsonResponse({ error: "sourcePath, action, and scheduledAt are required" }, 400);
      }

      const scheduled = await scheduler.schedule({
        sourcePath,
        action,
        scheduledAt,
        createdBy: authResult.user?.username,
      });

      return jsonResponse({ scheduled: true, action: scheduled }, 201);
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleCancelSchedule(actionId: string): Promise<Response> {
    if (!scheduler) return jsonResponse({ error: "Scheduler not enabled" }, 501);
    try {
      const cancelled = await scheduler.cancel(actionId);
      return jsonResponse({ cancelled });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleListScheduled(pagePath: string): Promise<Response> {
    if (!scheduler) return jsonResponse({ error: "Scheduler not enabled" }, 501);
    try {
      const actions = await scheduler.listForPage(pagePath);
      return jsonResponse({ items: actions, total: actions.length });
    } catch (err) {
      return serverError(err);
    }
  }

  // === History handlers ===

  async function handleGetHistory(pagePath: string): Promise<Response> {
    if (!history) return jsonResponse({ error: "History not enabled" }, 501);
    try {
      const revisions = await history.getHistory(pagePath);
      return jsonResponse({ items: revisions, total: revisions.length });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleGetRevision(pagePath: string, revNum: number): Promise<Response> {
    if (!history) return jsonResponse({ error: "History not enabled" }, 501);
    try {
      const revision = await history.getRevision(pagePath, revNum);
      if (!revision) return jsonResponse({ error: "Revision not found" }, 404);
      return jsonResponse(revision);
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleDiffRevision(pagePath: string, revNum: number): Promise<Response> {
    if (!history) return jsonResponse({ error: "History not enabled" }, 501);
    try {
      // Get current content
      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

      const page = await engine.loadPage(pageIndex.sourcePath);
      const currentContent = page.rawContent ?? "";

      const diff = await history.diffWithCurrent(pagePath, revNum, currentContent);
      if (!diff) return jsonResponse({ error: "Revision not found" }, 404);
      return jsonResponse(diff);
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleRestoreRevision(pagePath: string, revNum: number): Promise<Response> {
    if (!history) return jsonResponse({ error: "History not enabled" }, 501);
    try {
      const revision = await history.getRevision(pagePath, revNum);
      if (!revision) return jsonResponse({ error: "Revision not found" }, 404);

      // Write the revision content back to the file
      const contentDir = config.config.system.content.dir;
      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

      const filePath = `${contentDir}/${pageIndex.sourcePath}`;

      // Reconstruct file: frontmatter + content
      // Use @std/yaml stringify to safely serialize frontmatter.
      const fmYaml = stringifyYaml(revision.frontmatter as Record<string, unknown>).trimEnd();
      const fullContent = `---\n${fmYaml}\n---\n\n${revision.content}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));
      await engine.rebuild();

      return jsonResponse({ restored: true, revision: revNum });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Revision history page ===

  async function handleRevisionHistoryPage(url: URL, authResult: AuthResult): Promise<Response> {
    const sourcePath = url.searchParams.get("path");
    if (!sourcePath) {
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/pages` },
      });
    }

    const userName = authResult.user?.name ?? "Admin";
    const revisions = history ? await history.getHistory(sourcePath) : [];

    // Get current content
    let currentContent = "";
    try {
      const page = await engine.loadPage(sourcePath);
      currentContent = page.rawContent ?? "";
    } catch { /* ignore */ }

    const content = renderRevisionHistory(prefix, {
      sourcePath,
      revisions,
      currentContent,
    });

    return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>History: ${escapeHtml(sourcePath)} — Dune Admin</title>
  <style>${baseAdminStyles()}${revisionHistoryStyles()}</style>
</head>
<body>
  ${adminShell(prefix, "pages", userName, content)}
  ${renderRevisionScripts(prefix)}
</body>
</html>`);
  }

  // === Contact form submission handler (public) ===

  async function handleContactSubmission(req: Request): Promise<Response> {
    if (!submissions) {
      return jsonResponse({ error: "Submissions not enabled" }, 501);
    }
    try {
      // Rate limit by IP: 5 submissions per minute
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
        ?? req.headers.get("x-real-ip")
        ?? "unknown";
      if (!contactRateLimiter.check(ip)) {
        const retryAfter = contactRateLimiter.retryAfter(ip);
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        });
      }

      const contentType = req.headers.get("content-type") ?? "";
      let fields: Record<string, string> = {};

      if (contentType.includes("application/json")) {
        const body = await req.json();
        for (const [k, v] of Object.entries(body)) {
          if (typeof v === "string") fields[k] = v;
        }
      } else {
        // application/x-www-form-urlencoded or multipart/form-data
        const formData = await req.formData();
        for (const [k, v] of formData.entries()) {
          if (typeof v === "string") fields[k] = v;
        }
      }

      // Basic required field validation
      if (!fields.name && !fields.email) {
        return jsonResponse({ error: "Missing required fields" }, 400);
      }

      const language = req.headers.get("accept-language") ?? undefined;
      const userAgent = req.headers.get("user-agent") ?? undefined;

      // Use form_name field if provided (allows multiple forms), otherwise default to "contact".
      // Validate form_name: it becomes a filesystem directory name, so restrict to safe chars.
      // Only alphanumeric, hyphens, and underscores — no slashes, dots, or special chars.
      const rawFormName = fields.form_name ?? "contact";
      delete fields.form_name;
      const formName = /^[a-zA-Z0-9_-]{1,64}$/.test(rawFormName) ? rawFormName : "contact";

      await submissions.create(formName, fields, {
        ip: ip === "unknown" ? undefined : ip,
        language,
        userAgent,
      });

      // Support both JSON and form POST responses
      const acceptsJson = req.headers.get("accept")?.includes("application/json");
      if (acceptsJson) {
        return jsonResponse({ ok: true });
      }

      // Redirect back (form POST) — validate Referer is same-origin to prevent open redirect.
      // If Referer is missing, cross-origin, or unparseable, fall back to "/".
      const requestOrigin = new URL(req.url).origin;
      const refererHeader = req.headers.get("referer");
      let redirectPath = "/";
      if (refererHeader) {
        try {
          const refererUrl = new URL(refererHeader);
          if (refererUrl.origin === requestOrigin) {
            // Safe: same-origin — keep the path+query, append ?submitted=1
            refererUrl.searchParams.set("submitted", "1");
            redirectPath = refererUrl.pathname + refererUrl.search;
          }
        } catch {
          // Unparseable Referer — fall back to "/"
        }
      }
      return new Response(null, {
        status: 302,
        headers: { "Location": redirectPath },
      });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Submissions UI pages ===

  async function handleSubmissionsIndex(authResult: AuthResult): Promise<Response> {
    if (!submissions) {
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin", `
        <h2>Submissions</h2>
        <p style="color:#999">Submissions are not configured.</p>
      `));
    }
    try {
      // List all form directories under the submissions dir
      const adminCfg = config.config.admin!;
      const submissionsDir = `${adminCfg.dataDir}/submissions`;
      let formDirs: string[] = [];
      try {
        const entries = await storage.list(submissionsDir);
        formDirs = entries.filter((e) => e.isDirectory).map((e) => e.name);
      } catch { /* no submissions yet */ }

      if (formDirs.length === 0) {
        return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin", `
          <h2>Submissions</h2>
          <p style="color:#999;padding:2rem 0">No submissions yet. They will appear here once your contact form receives its first message.</p>
        `));
      }

      // Build a summary row per form
      const rows = await Promise.all(formDirs.map(async (form) => {
        const newCount = await submissions!.countNew(form);
        const list = await submissions!.list(form);
        const total = list.length;
        const latest = list[0];
        return { form, newCount, total, latest };
      }));

      const tableRows = rows.map((r) => `
        <tr>
          <td><a href="${prefix}/submissions/${encodeURIComponent(r.form)}">${escapeHtml(r.form)}</a></td>
          <td>${r.total}</td>
          <td>${r.newCount > 0 ? `<span class="sub-badge sub-badge-new">${r.newCount} new</span>` : "—"}</td>
          <td>${r.latest ? formatDate(r.latest.receivedAt) : "—"}</td>
        </tr>`).join("");

      const content = `
        <h2>Submissions</h2>
        <table class="admin-table">
          <thead>
            <tr><th>Form</th><th>Total</th><th>New</th><th>Latest</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`;

      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin", content));
    } catch (err) {
      console.error("  ❌ Admin server error [submissions-index]:", err instanceof Error ? err.message : err);
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin",
        `<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>`), 500);
    }
  }

  async function handleSubmissionsListPage(form: string, authResult: AuthResult): Promise<Response> {
    if (!submissions) {
      return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions` } });
    }
    try {
      const list = await submissions.list(form);
      const newCount = list.filter((s) => s.status === "new").length;
      // Mark "new" submissions as "read" when listing them
      // (don't auto-mark — let admin explicitly mark)
      const content = renderSubmissionsList(prefix, form, list, newCount);
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin", content));
    } catch (err) {
      console.error("  ❌ Admin server error [submissions-list]:", err instanceof Error ? err.message : err);
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin",
        `<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>`), 500);
    }
  }

  async function handleSubmissionDetailPage(form: string, id: string, authResult: AuthResult): Promise<Response> {
    if (!submissions) {
      return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions` } });
    }
    try {
      const submission = await submissions.get(form, id);
      if (!submission) {
        return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin",
          `<h1>Submission not found</h1>`), 404);
      }
      // Auto-mark as read when opening detail view
      if (submission.status === "new") {
        await submissions.setStatus(form, id, "read");
        submission.status = "read";
      }
      const content = renderSubmissionDetail(prefix, form, submission);
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin", content));
    } catch (err) {
      console.error("  ❌ Admin server error [submission-detail]:", err instanceof Error ? err.message : err);
      return htmlResponse(renderSubmissionsShell(prefix, "submissions", authResult.user?.name ?? "Admin",
        `<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>`), 500);
    }
  }

  async function handleSubmissionStatusUpdate(req: Request, form: string, id: string): Promise<Response> {
    if (!submissions) return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions` } });
    try {
      const formData = await req.formData();
      const status = formData.get("status") as string;
      if (!["new", "read", "archived"].includes(status)) {
        return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions/${encodeURIComponent(form)}/${id}` } });
      }
      await submissions.setStatus(form, id, status as SubmissionStatus);
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/submissions/${encodeURIComponent(form)}/${id}` },
      });
    } catch {
      return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions/${encodeURIComponent(form)}` } });
    }
  }

  async function handleSubmissionDelete(form: string, id: string): Promise<Response> {
    if (!submissions) return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions` } });
    try {
      await submissions.delete(form, id);
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/submissions/${encodeURIComponent(form)}` },
      });
    } catch {
      return new Response(null, { status: 302, headers: { "Location": `${prefix}/submissions/${encodeURIComponent(form)}` } });
    }
  }

  // === Submissions shell page helper ===

  function renderSubmissionsShell(pfx: string, active: string, userName: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Submissions — Dune Admin</title>
  <style>${baseAdminStyles()}${submissionsTableStyles()}${submissionStyles()}</style>
</head>
<body>
  ${adminShell(pfx, active, userName, content)}
</body>
</html>`;
  }

  // === i18n page ===

  function renderI18nPage(pfx: string, authResult: AuthResult): string {
    const userName = authResult.user?.name ?? "Admin";
    const languages = config.config.system.languages?.supported ?? [];
    const defaultLang = config.config.system.languages?.default ?? "en";

    // Build translation data — one row per route (use default-language pages to avoid duplicates)
    const otherLangs = languages.filter((l: string) => l !== defaultLang);
    const defaultLangPages = engine.pages.filter((p) => p.language === defaultLang);
    const pages = defaultLangPages.map((p) => {
      const translations: Record<string, { exists: boolean; upToDate: boolean }> = {};
      for (const lang of otherLangs) {
        const langPath = p.sourcePath.replace(/\.(md|mdx|tsx)$/, `.${lang}.$1`);
        const exists = engine.pages.some((pp) => pp.sourcePath === langPath);
        translations[lang] = { exists, upToDate: exists };
      }
      return { sourcePath: p.sourcePath, title: p.title, route: p.route, translations };
    });

    const content = renderTranslationStatus(pfx, { languages, defaultLanguage: defaultLang, pages });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Translations — Dune Admin</title>
  <style>${baseAdminStyles()}${translationStatusStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "i18n", userName, `
    <h2>Translations</h2>
    ${content}
  `)}
</body>
</html>`;
  }

  function requirePermission(authResult: AuthResult, permission: AdminPermission): void {
    if (!auth.hasPermission(authResult, permission)) {
      throw new PermissionError(permission);
    }
  }
}

/**
 * Validate that a page path is safe to use as a filesystem path segment.
 *
 * A valid page path:
 * - Is a non-empty string
 * - Contains no null bytes
 * - Does not start with "/"
 * - Does not end with "/"
 * - Contains no consecutive slashes
 * - Has no "." or ".." segments (prevents directory traversal)
 * - Contains only alphanumeric characters, hyphens, underscores, and dots per segment
 */
export function validatePagePath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  if (path.endsWith("/")) return false;
  if (path.includes("//")) return false;
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..") return false;
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) return false;
  }
  return true;
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
    { id: "i18n", label: "Translations", icon: "🌐", href: `${prefix}/i18n` },
    { id: "submissions", label: "Submissions", icon: "📬", href: `${prefix}/submissions` },
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
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Security headers for all admin HTML pages.
      // script-src and style-src include 'unsafe-inline' because the admin
      // panel renders inline <script> and <style> blocks throughout.
      // frame-ancestors 'none' is the critical clickjacking protection.
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: *",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Log an unexpected error server-side and return a generic 500 response.
 * Never includes the raw error message in the client response — that would
 * leak stack traces, file paths, and implementation details.
 */
function serverError(err: unknown, context?: string): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`  ❌ Admin server error${context ? ` [${context}]` : ""}: ${message}`);
  return jsonResponse({ error: "Internal server error" }, 500);
}

/**
 * Same as serverError() but returns an HTML response for UI routes.
 */
function serverErrorHtml(err: unknown, context?: string): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`  ❌ Admin server error${context ? ` [${context}]` : ""}: ${message}`);
  return htmlResponse("<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>", 500);
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

function submissionsTableStyles(): string {
  return `
  .admin-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .admin-table th { text-align: left; padding: 0.6rem 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; border-bottom: 1px solid #e0e0e0; background: #fafafa; }
  .admin-table td { padding: 0.6rem 0.75rem; font-size: 0.85rem; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  .admin-table tr:last-child td { border-bottom: none; }
  .admin-table a { color: #c9a96e; text-decoration: none; }
  .admin-table a:hover { text-decoration: underline; }
  `;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-CH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
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
