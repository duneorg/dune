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
 *   POST /admin/api/pages/translate → Create a language translation copy of a page
 *   PUT  /admin/api/pages/:path → Update page
 *   DELETE /admin/api/pages/:path → Delete page
 *   GET    /admin/api/media        → List all media (JSON)
 *   POST   /admin/api/media/upload → Upload a media file (multipart/form-data)
 *   DELETE /admin/api/media        → Delete a media file
 *   PUT    /admin/api/media/meta   → Save media sidecar metadata (focal point, etc.)
 *   GET  /admin/i18n/memory   → Translation Memory admin page
 *   GET  /admin/api/i18n/memory → List TM entries for a language pair (JSON)
 *   POST /admin/api/i18n/memory → Add/update TM entry
 *   DELETE /admin/api/i18n/memory → Delete TM entry
 *   POST /admin/api/i18n/memory/rebuild → Rebuild TM from existing translations
 *   GET  /admin/api/i18n/mt-status     → Machine translation availability probe
 *   POST /admin/api/i18n/translate-page    → Machine-translate an entire page (creates file)
 *   POST /admin/api/i18n/translate-segment → Machine-translate a single segment
 *   GET  /admin/api/users     → List users (admin only)
 *   POST /admin/api/users     → Create user (admin only)
 *   PUT  /admin/api/users/:id → Update user (role, name, email, enabled)
 *   POST /admin/api/users/:id/password → Change a user's password
 *   DELETE /admin/api/users/:id → Delete user
 *   GET  /admin/api/config    → Read config (JSON)
 *   POST /admin/api/editor/parse     → Markdown → Blocks
 *   POST /admin/api/editor/serialize → Blocks → Markdown
 *   POST /admin/api/preview   → Render preview HTML
 *   GET  /admin/themes        → Theme marketplace page
 *   GET  /admin/api/theme-preview?theme=X&route=/path → Render page with preview theme
 *   GET  /admin/api/registry/themes  → Bundled theme registry JSON
 *   POST /admin/api/themes/install   → Download + extract theme ZIP
 *
 * Public routes (no admin auth):
 *   POST /api/contact                → Accept contact form submissions
 *   GET  /api/forms/:name            → Return form schema as JSON (blueprint-driven forms)
 *   POST /api/forms/:name            → Accept and validate a blueprint-driven form submission
 *   POST /api/webhook/incoming       → Incoming webhook — token-authenticated action trigger
 *
 * Staging (draft preview before publish):
 *   POST   /admin/api/staging/:path         → Upsert draft + return preview token
 *   GET    /admin/api/staging/:path         → Get current draft metadata
 *   DELETE /admin/api/staging/:path         → Discard draft
 *   POST   /admin/api/staging/:path/publish → Publish draft to live file
 */

import { stringify as stringifyYaml, parse as parseYaml } from "@std/yaml";
import { dirname, basename, join } from "@std/path";
import { parseContentFilename, isMediaFile } from "../content/path-utils.ts";
import { getMimeType } from "../content/page-loader.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { AuthMiddleware } from "./auth/middleware.ts";
import type { UserManager } from "./auth/users.ts";
import type { SessionManager } from "./auth/sessions.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { AdminPermission, AuthResult } from "./types.ts";
import { toUserInfo } from "./types.ts";
import { verifyPassword } from "./auth/passwords.ts";
import { renderLoginPage, renderDashboardPage, renderShellPage, applyAdminRtl } from "./ui/pages.ts";
import { renderPageTree, renderSearchResults, PAGES_PER_PAGE } from "./ui/page-tree.ts";
import { renderPageEditorPage } from "./ui/page-editor.ts";
import { renderMediaLibrary } from "./ui/media-library.ts";
import { markdownToBlocks, blocksToMarkdown } from "./editor/serializer.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import {
  renderFlexTypeList,
  renderFlexRecordList,
  renderFlexEditor,
  flexScript,
  flexStyles,
} from "./ui/flex-objects.ts";
import { renderRevisionHistory, renderRevisionScripts, revisionHistoryStyles } from "./ui/revision-history.ts";
import { renderTranslationStatus, translationStatusStyles } from "./ui/translation-status.ts";
import { renderTMPage, tmPageStyles, type TMPageData } from "./ui/translation-memory.ts";
import {
  extractSegments,
  buildTMFromPages,
  loadTM,
  saveTM,
  lookupSuggestions,
} from "./tm.ts";
import { renderWorkflowPanel, workflowPanelStyles } from "./ui/workflow-panel.ts";
import type { SubmissionManager, SubmissionStatus } from "./submissions.ts";
import {
  renderSubmissionsList,
  renderSubmissionDetail,
  submissionStyles,
} from "./ui/submissions.ts";
import { resolveBlueprint, validateFrontmatter } from "../blueprints/validator.ts";
import { renderConfigEditor, configEditorStyles, type ConfigEditorThemeData } from "./ui/config-editor.ts";
import { renderPluginsPage, pluginStyles } from "./ui/plugins.ts";
import { renderThemesPage, type ThemeRegistry, type InstalledThemeInfo } from "./ui/themes.ts";
import { h, type ComponentType } from "preact";
import { render as renderJsxToString } from "preact-render-to-string";
import { buildPageTitle } from "../content/types.ts";
import { validateConfig } from "../config/validator.ts";
import { renderUsersPage, userStyles, type UsersPageData } from "./ui/users.ts";
import type { ResolvedBlueprint } from "../blueprints/types.ts";
import type { HookRegistry } from "../hooks/types.ts";
import { sendSubmissionEmail } from "./email.ts";
import { sendWebhookNotification } from "./webhook.ts";
import type { SubmissionFile } from "./submissions.ts";
import { encodeHex } from "@std/encoding/hex";
import { loadForm } from "../forms/loader.ts";
import { validateFormSubmission } from "../forms/validator.ts";
import type { StagingEngine } from "../staging/engine.ts";
import { fireContentWebhooks, listDeliveryLogs } from "./webhooks.ts";
import { createSearchAnalytics } from "../search/analytics.ts";
import type { CommentManager } from "./comments.ts";
import type { CollabManager } from "../collab/mod.ts";
import type { ImageCache } from "../images/cache.ts";
import type { AuditLogger } from "../audit/mod.ts";
import type { MetricsCollector } from "../metrics/mod.ts";
import type { MachineTranslator } from "../mt/mod.ts";

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
  flex?: FlexEngine;
  /** Hook registry — exposes registered plugins to the admin panel */
  hooks?: HookRegistry;
  /** Staging engine — draft preview before publishing */
  staging?: StagingEngine;
  /** Comment manager — page annotations and editorial comments */
  comments?: CommentManager;
  /** Real-time collaboration WebSocket manager */
  collab?: CollabManager;
  /** Image cache — used by the purge-cache incoming webhook action */
  imageCache?: ImageCache;
  /** Audit logger — records admin panel actions */
  auditLogger?: AuditLogger;
  /** In-process performance metrics collector */
  metrics?: MetricsCollector;
  /** Machine translation provider — omit when not configured */
  mt?: MachineTranslator | null;
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
  const { engine, storage, auth, users, sessions, prefix, workflow, scheduler, history, submissions, flex, hooks, staging, comments, collab, imageCache, auditLogger, metrics, mt } = config;
  const adminConfig = config.config.admin!;

  /** Extract IP address from a request, checking proxy headers first. */
  function getRequestIp(req: Request): string | null {
    return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? req.headers.get("x-real-ip")
      ?? null;
  }

  /** Extract User-Agent from a request. */
  function getRequestUa(req: Request): string | null {
    return req.headers.get("user-agent");
  }

  /** Build an AuditActor from an AuthResult, or null if not authenticated. */
  function actorFromAuth(authResult: { user?: { id: string; username: string; name: string } | null }): import("../audit/mod.ts").AuditActor | null {
    if (!authResult.user) return null;
    return {
      userId: authResult.user.id,
      username: authResult.user.username,
      name: authResult.user.name,
    };
  }

  // Sanity-check the prefix at startup.  A prefix that doesn't start with "/"
  // causes path.startsWith(prefix) to match unintended routes or fail silently.
  if (!prefix.startsWith("/")) {
    throw new Error(`Admin prefix must start with "/" — got: ${JSON.stringify(prefix)}`);
  }

  // RTL-aware HTML response helper.
  // Shadows the module-level _htmlResponseBase so all inner functions within
  // createAdminHandler automatically get dir="rtl" and RTL CSS when the site's
  // default language is right-to-left.  Module-level helpers use _htmlResponseBase
  // directly (error pages don't need language-specific direction).
  const htmlResponse = (html: string, status = 200): Response =>
    _htmlResponseBase(
      html,
      status,
      config.config.system.languages?.default ?? "en",
      config.config.system.languages?.rtl_override,
    );

  return async function handleAdminRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // === Public contact form endpoint ===
    // POST /api/contact — accepts contact form data, no admin auth required
    if (path === "/api/contact" && req.method === "POST") {
      return handleContactSubmission(req);
    }

    // === Blueprint-driven form endpoints (public) ===
    // GET  /api/forms/:name — return form schema as JSON
    // POST /api/forms/:name — accept and validate a form submission
    const formsMatch = path.match(/^\/api\/forms\/([a-zA-Z0-9_-]+)$/);
    if (formsMatch) {
      const formName = formsMatch[1];
      if (req.method === "GET") return handleFormSchema(formName);
      if (req.method === "POST") return handleFormSubmission(req, formName);
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }

    // === Incoming webhooks (public) ===
    // POST /api/webhook/incoming — token-authenticated action trigger
    if (path === "/api/webhook/incoming" && method === "POST") {
      return handleIncomingWebhook(req);
    }

    // Only handle admin routes
    if (!path.startsWith(prefix)) return null;

    // Strip prefix to get the admin-relative path
    const adminPath = path.slice(prefix.length) || "/";

    // === Real-time collaboration WebSocket endpoint ===
    // GET /admin/collab/ws?docId=... (Upgrade: websocket)
    // Auth is required; the upgrade must happen before any async logic.
    if (
      adminPath === "/collab/ws" &&
      req.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      const authResult = await auth.authenticate(req);
      if (!authResult.authenticated || !authResult.user) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!collab) {
        return new Response("Collaboration not enabled", { status: 501 });
      }
      return collab.handleUpgrade(req, authResult.user);
    }

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
      void auditLogger?.log({
        event: "auth.logout",
        actor: actorFromAuth(authResult),
        ip: getRequestIp(req),
        userAgent: getRequestUa(req),
        target: null,
        detail: {},
        outcome: "success",
      }).catch(() => {});
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

    // GET /admin/pages — Page tree (or search results when ?q= is present)
    if (adminPath === "/pages") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
      return htmlResponse(renderPageTreePage(prefix, authResult, q, page));
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

    // GET /admin/i18n/memory — Translation Memory admin page
    if (adminPath === "/i18n/memory" && method === "GET") {
      return htmlResponse(await renderTMAdminPage(prefix, url, authResult));
    }

    // GET /admin/api/i18n/memory?from=en&to=de — List TM entries
    if (adminPath === "/api/i18n/memory" && method === "GET") {
      return handleListTM(url);
    }

    // POST /admin/api/i18n/memory/rebuild — Rebuild TM from existing translations
    if (adminPath === "/api/i18n/memory/rebuild" && method === "POST") {
      requirePermission(authResult, "pages.read");
      return handleRebuildTM(req);
    }

    // POST /admin/api/i18n/memory — Add/update a TM entry
    if (adminPath === "/api/i18n/memory" && method === "POST") {
      requirePermission(authResult, "pages.update");
      return handleAddTMEntry(req);
    }

    // DELETE /admin/api/i18n/memory — Remove a TM entry
    if (adminPath === "/api/i18n/memory" && method === "DELETE") {
      requirePermission(authResult, "pages.update");
      return handleDeleteTMEntry(req);
    }

    // GET /admin/api/i18n/mt-status — MT availability probe
    if (adminPath === "/api/i18n/mt-status" && method === "GET") {
      return handleMTStatus();
    }

    // POST /admin/api/i18n/translate-page — Machine-translate an entire page
    if (adminPath === "/api/i18n/translate-page" && method === "POST") {
      requirePermission(authResult, "pages.create");
      return handleMachineTranslatePage(req);
    }

    // POST /admin/api/i18n/translate-segment — Machine-translate a single segment
    if (adminPath === "/api/i18n/translate-segment" && method === "POST") {
      requirePermission(authResult, "pages.read");
      return handleMachineTranslateSegment(req);
    }

    // GET /admin/config — Config editor
    if (adminPath === "/config" && req.method === "GET") {
      if (!auth.hasPermission(authResult, "config.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return htmlResponse(await renderConfigPage(prefix, authResult));
    }

    // PUT /admin/api/config — Save config
    if (adminPath === "/api/config" && req.method === "PUT") {
      if (!auth.hasPermission(authResult, "config.update")) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
      const cfgResp = await handleConfigSave(req);
      if (cfgResp.status === 200) {
        void auditLogger?.log({
          event: "config.update",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "config" },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return cfgResp;
    }

    // GET /admin/users — User management
    if (adminPath === "/users") {
      if (!auth.hasPermission(authResult, "users.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return htmlResponse(await renderUsersPageHtml(prefix, authResult));
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

    // GET /admin/submissions/:form/:id/files/:filename — download uploaded file attachment
    if (adminPath.startsWith("/submissions/") && adminPath.split("/").length === 6 && adminPath.split("/")[4] === "files" && req.method === "GET") {
      if (!auth.hasPermission(authResult, "submissions.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      const parts = adminPath.split("/");
      const form = decodeURIComponent(parts[2]);
      const id = parts[3];
      const filename = basename(decodeURIComponent(parts[5]));
      return handleSubmissionFileDownload(form, id, filename);
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

    // === Plugin management UI ===

    // GET /admin/plugins — Plugin list page
    if (adminPath === "/plugins" && req.method === "GET") {
      const plugins = hooks?.plugins() ?? [];
      return htmlResponse(
        renderPluginsPage(prefix, plugins, config.config.plugins, authResult),
      );
    }

    // GET /admin/themes — Theme marketplace
    if (adminPath === "/themes" && req.method === "GET") {
      if (!auth.hasPermission(authResult, "config.read")) {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return htmlResponse(await renderThemesPageHtml(prefix, authResult));
    }

    // === Flex Object UI routes ===

    // GET /admin/flex — Type list
    if (adminPath === "/flex" && req.method === "GET") {
      return handleFlexTypeListPage(authResult);
    }

    // GET /admin/flex/:type — Record list
    if (adminPath.startsWith("/flex/") && adminPath.split("/").length === 3 && req.method === "GET") {
      const type = decodeURIComponent(adminPath.split("/")[2]);
      return handleFlexRecordListPage(type, authResult);
    }

    // GET /admin/flex/:type/new — Create form
    // GET /admin/flex/:type/:id — Edit form
    if (adminPath.startsWith("/flex/") && adminPath.split("/").length === 4 && req.method === "GET") {
      const parts = adminPath.split("/");
      const type = decodeURIComponent(parts[2]);
      const idOrNew = decodeURIComponent(parts[3]);
      const recordId = idOrNew === "new" ? null : idOrNew;
      return handleFlexEditorPage(type, recordId, authResult);
    }

    // GET /admin/audit — Audit log viewer (admin only)
    if (adminPath === "/audit" && req.method === "GET") {
      if (authResult.user?.role !== "admin") {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return handleAuditPage(url, authResult);
    }

    // GET /admin/api/metrics — Metrics snapshot JSON (admin only)
    if (adminPath === "/api/metrics" && req.method === "GET") {
      if (authResult.user?.role !== "admin") {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
      if (!metrics) {
        return jsonResponse({ error: "Metrics not enabled" }, 404);
      }
      return jsonResponse(metrics.snapshot());
    }

    // GET /admin/metrics — Metrics dashboard page (admin only)
    if (adminPath === "/metrics" && req.method === "GET") {
      if (authResult.user?.role !== "admin") {
        return htmlResponse("<h1>403 Forbidden</h1>", 403);
      }
      return handleMetricsPage(authResult);
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
      // Always run verifyPassword regardless of whether the user exists to prevent
      // username enumeration via response-time differences (timing oracle).
      const DUMMY_HASH =
        "pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
      const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
      const valid = await verifyPassword(password, hashToVerify);
      if (!user || !user.enabled || !valid) {
        void auditLogger?.log({
          event: "auth.login_failed",
          actor: null,
          ip: ip === "unknown" ? null : ip,
          userAgent: req.headers.get("user-agent"),
          target: null,
          detail: { username },
          outcome: "failure",
        }).catch(() => {});
        return htmlResponse(renderLoginPage(prefix, "Invalid credentials"), 401);
      }

      // Revoke all existing sessions for this user before issuing a new one.
      // Prevents session proliferation and limits the impact of stolen session tokens.
      await sessions.revokeAll(user.id);

      // Create session (reuse ip from rate limiting above)
      const session = await sessions.create(user.id, ip === "unknown" ? undefined : ip);

      void auditLogger?.log({
        event: "auth.login",
        actor: { userId: user.id, username: user.username, name: user.name },
        ip: ip === "unknown" ? null : ip,
        userAgent: req.headers.get("user-agent"),
        target: null,
        detail: {},
        outcome: "success",
      }).catch(() => {});

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

      // Build taxonomy suggestion lists from the engine's taxonomy map
      const configuredTaxonomies = engine.config.site.taxonomies ?? ["category", "tag"];
      const taxonomyValues: Record<string, string[]> = {};
      for (const taxName of configuredTaxonomies) {
        taxonomyValues[taxName] = Object.keys(engine.taxonomyMap[taxName] ?? {});
      }

      // Resolve the blueprint for this page's template (null if none defined)
      const blueprintDef = engine.blueprints[page.template];
      const resolvedBlueprint: ResolvedBlueprint | null = blueprintDef
        ? resolveBlueprint(page.template, blueprintDef, engine.blueprints, 0)
        : null;

      // Fetch revision count for the History button badge (0 if history not enabled)
      const revisionCount = history ? await history.getRevisionCount(page.sourcePath) : 0;

      // === Multilingual translation context ===
      const supportedLangs = engine.config.system.languages?.supported ?? [];
      const defaultLang = engine.config.system.languages?.default ?? "en";
      const isMultilingual = supportedLangs.length > 1;

      let pageLanguage = defaultLang;
      let translations: Array<{ lang: string; sourcePath: string; exists: boolean }> = [];
      let referenceContent: string | null = null;

      if (isMultilingual) {
        const dir = dirname(page.sourcePath);
        const filename = basename(page.sourcePath);
        const fileInfo = parseContentFilename(filename, supportedLangs);

        if (fileInfo) {
          pageLanguage = fileInfo.language ?? defaultLang;

          // Build sibling list for every supported language
          for (const lang of supportedLangs) {
            const siblingPath = lang === defaultLang
              ? `${dir}/${fileInfo.template}${fileInfo.ext}`
              : `${dir}/${fileInfo.template}.${lang}${fileInfo.ext}`;
            const exists = engine.pages.some((p) => p.sourcePath === siblingPath);
            translations.push({ lang, sourcePath: siblingPath, exists });
          }

          // Load default-lang raw content as a reference when editing a translation
          if (pageLanguage !== defaultLang) {
            const defaultPath = `${dir}/${fileInfo.template}${fileInfo.ext}`;
            if (engine.pages.some((p) => p.sourcePath === defaultPath)) {
              try {
                const refPage = await engine.loadPage(defaultPath);
                referenceContent = refPage.rawContent ?? null;
              } catch { /* skip if not loadable */ }
            }
          }
        }
      }

      // Load TM suggestions when editing a non-default-language page
      let tmSuggestions: Array<{ source: string; target: string }> = [];
      if (
        referenceContent != null &&
        pageLanguage !== defaultLang &&
        defaultLang
      ) {
        const contentDir = config.config.system.content.dir;
        const tm = await loadTM(storage, contentDir, defaultLang, pageLanguage);
        const segments = extractSegments(referenceContent);
        tmSuggestions = lookupSuggestions(tm, segments);
      }

      // Fetch username list for @mention autocomplete
      const allUsers = await users.list();
      const usernames = allUsers.map((u) => u.username);

      // Use the page's own language (not the site default) to determine RTL
      // direction for the editor shell — editors working in Arabic, Hebrew, etc.
      // get a mirrored UI matching their content's reading direction.
      return _htmlResponseBase(
        renderPageEditorPage(prefix, userName, {
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
          taxonomies: configuredTaxonomies,
          taxonomyValues,
          blueprint: resolvedBlueprint,
          revisionCount,
          language: pageLanguage,
          defaultLanguage: defaultLang,
          translations,
          referenceContent,
          tmSuggestions,
          users: usernames,
        }),
        200,
        pageLanguage,
        config.config.system.languages?.rtl_override,
      );
    } catch (err) {
      return htmlResponse(`<h1>Page not found</h1><p>${escapeHtml(String(err))}</p>`, 404);
    }
  }

  // === Page tree page ===

  function renderPageTreePage(
    pfx: string,
    authResult: AuthResult,
    q: string,
    page: number,
  ): string {
    const userName = authResult.user?.name ?? "Admin";
    const knownTemplates = Object.keys(engine.blueprints);

    let body: string;
    let title: string;
    if (q) {
      const lower = q.toLowerCase();
      const filtered = engine.pages.filter(
        (p) =>
          p.route.toLowerCase().includes(lower) ||
          (p.title ?? "").toLowerCase().includes(lower),
      );
      const total = filtered.length;
      const offset = (page - 1) * PAGES_PER_PAGE;
      const slice = filtered.slice(offset, offset + PAGES_PER_PAGE);
      body = renderSearchResults(slice, q, page, total, PAGES_PER_PAGE, pfx);
      title = `Search: ${q} — Pages — Dune Admin`;
    } else {
      body = renderPageTree(engine.pages, pfx, knownTemplates);
      title = "Pages — Dune Admin";
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${pageTreeStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "pages", userName, `
    <h2>Pages</h2>
    ${body}
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
    //
    // We compare only the HOST (hostname + port), not the full origin, so the
    // check stays valid when a TLS-terminating reverse proxy (e.g. OLS/nginx)
    // forwards requests over plain HTTP.  The browser sends
    //   Origin: https://yoursite.com
    // while Deno sees
    //   req.url = http://yoursite.com/...  (HTTP, post-proxy)
    // Comparing full origins would always fail (https ≠ http).  Comparing hosts
    // is still safe: a CSRF attacker at evil.com cannot spoof a matching host.
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const requestHost = new URL(req.url).host;
      const origin = req.headers.get("origin");
      if (origin !== null) {
        let originHost: string;
        try {
          originHost = new URL(origin).host;
        } catch {
          return jsonResponse({ error: "Forbidden: cross-origin request rejected" }, 403);
        }
        if (originHost !== requestHost) {
          return jsonResponse({ error: "Forbidden: cross-origin request rejected" }, 403);
        }
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

    // === Comments API ===
    // NOTE: These routes must appear BEFORE the generic /api/pages/:path catch-alls
    // because comment paths also start with /api/pages/.

    // GET /admin/api/comments/mentions — list @mentions for current user
    if (adminPath === "/api/comments/mentions" && method === "GET") {
      requirePermission(authResult, "pages.read");
      if (!comments || !authResult.user) return jsonResponse([]);
      const mentions = await comments.listMentions(authResult.user.username);
      return jsonResponse(mentions);
    }

    // POST /admin/api/comments/mentions/read — mark mentions as read
    if (adminPath === "/api/comments/mentions/read" && method === "POST") {
      requirePermission(authResult, "pages.read");
      if (!comments || !authResult.user) return jsonResponse({ ok: true });
      const readBody = await req.json().catch(() => ({})) as { ids?: unknown };
      const ids: string[] = Array.isArray(readBody.ids) ? readBody.ids as string[] : [];
      await comments.markRead(authResult.user.username, ids);
      return jsonResponse({ ok: true });
    }

    // POST /admin/api/pages/{path}/comments/{id}/resolve — resolve comment thread
    const commentResolveMatch = adminPath.match(
      /^\/api\/pages\/(.+)\/comments\/([a-f0-9]+)\/resolve$/,
    );
    if (commentResolveMatch && method === "POST") {
      requirePermission(authResult, "pages.read");
      if (!comments || !authResult.user) {
        return jsonResponse({ error: "Comments not available" }, 503);
      }
      const resolvePagePath = decodeURIComponent(commentResolveMatch[1]);
      const resolveCommentId = commentResolveMatch[2];
      const resolved = await comments.resolve(resolvePagePath, resolveCommentId, authResult.user.username);
      if (!resolved) return jsonResponse({ error: "Comment not found" }, 404);
      return jsonResponse(resolved);
    }

    // PATCH|DELETE /admin/api/pages/{path}/comments/{id} — edit or delete comment
    const commentIdMatch = adminPath.match(
      /^\/api\/pages\/(.+)\/comments\/([a-f0-9]+)$/,
    );
    if (commentIdMatch && (method === "PATCH" || method === "DELETE")) {
      requirePermission(authResult, "pages.read");
      if (!comments) return jsonResponse({ error: "Comments not available" }, 503);
      const editPagePath = decodeURIComponent(commentIdMatch[1]);
      const editCommentId = commentIdMatch[2];
      const existing = await comments.get(editPagePath, editCommentId);
      if (!existing) return jsonResponse({ error: "Comment not found" }, 404);
      // Ownership check: own comment OR pages.delete permission
      const canModify = existing.authorUsername === authResult.user?.username ||
        auth.hasPermission(authResult, "pages.delete");
      if (!canModify) return jsonResponse({ error: "Forbidden" }, 403);

      if (method === "PATCH") {
        const patchBody = await req.json().catch(() => ({})) as { body?: unknown };
        if (!patchBody.body || typeof patchBody.body !== "string") {
          return jsonResponse({ error: "Missing body" }, 400);
        }
        const updated = await comments.update(editPagePath, editCommentId, patchBody.body);
        return jsonResponse(updated);
      }

      // DELETE
      await comments.delete(editPagePath, editCommentId);
      return jsonResponse({ ok: true });
    }

    // GET|POST /admin/api/pages/{path}/comments — list or create comments
    const commentBaseMatch = adminPath.match(/^\/api\/pages\/(.+)\/comments$/);
    if (commentBaseMatch) {
      requirePermission(authResult, "pages.read");
      if (!comments) return jsonResponse({ error: "Comments not available" }, 503);
      const commentPagePath = decodeURIComponent(commentBaseMatch[1]);

      if (method === "GET") {
        const list = await comments.list(commentPagePath);
        return jsonResponse({ items: list, total: list.length });
      }

      if (method === "POST") {
        if (!authResult.user) return jsonResponse({ error: "Unauthorized" }, 401);
        const postBody = await req.json().catch(() => ({})) as { body?: unknown; parentId?: unknown; blockId?: unknown };
        if (!postBody.body || typeof postBody.body !== "string") {
          return jsonResponse({ error: "Missing body" }, 400);
        }
        const newComment = await comments.create(
          commentPagePath,
          {
            body: postBody.body,
            parentId: typeof postBody.parentId === "string" ? postBody.parentId : undefined,
            blockId: typeof postBody.blockId === "string" ? postBody.blockId : undefined,
          },
          authResult.user,
        );
        return jsonResponse(newComment, 201);
      }
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
      const createResp = await handleCreatePage(req);
      if (createResp.status === 201) {
        const createBody = await createResp.clone().json().catch(() => ({})) as { file?: string };
        void auditLogger?.log({
          event: "page.create",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "page", id: createBody.file },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return createResp;
    }

    // POST /admin/api/pages/reorder — Reorder pages within their sibling group
    if (adminPath === "/api/pages/reorder" && method === "POST") {
      requirePermission(authResult, "pages.update");
      return handleReorderPage(req);
    }

    // POST /admin/api/pages/translate — Create a language translation copy of a page
    if (adminPath === "/api/pages/translate" && method === "POST") {
      requirePermission(authResult, "pages.create");
      return handleCreateTranslation(req);
    }

    // PUT /admin/api/pages/* — Update a page
    if (adminPath.startsWith("/api/pages/") && method === "PUT") {
      requirePermission(authResult, "pages.update");
      const pagePath = decodeURIComponent(adminPath.replace("/api/pages/", ""));
      const updateResp = await handleUpdatePage(req, pagePath);
      if (updateResp.status === 200) {
        void auditLogger?.log({
          event: "page.update",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "page", id: pagePath },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return updateResp;
    }

    // DELETE /admin/api/pages/* — Delete a page
    if (adminPath.startsWith("/api/pages/") && method === "DELETE") {
      requirePermission(authResult, "pages.delete");
      const pagePath = decodeURIComponent(adminPath.replace("/api/pages/", ""));
      const deleteResp = await handleDeletePage(pagePath);
      if (deleteResp.status === 200) {
        void auditLogger?.log({
          event: "page.delete",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "page", id: pagePath },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return deleteResp;
    }

    // GET /admin/api/media — List all media files across all pages
    if (adminPath === "/api/media" && method === "GET") {
      requirePermission(authResult, "media.read");
      return handleListMedia();
    }

    // POST /admin/api/media/upload — Upload a media file co-located with a page
    if (adminPath === "/api/media/upload" && method === "POST") {
      requirePermission(authResult, "media.upload");
      const upResp = await handleUploadMedia(req);
      if (upResp.status === 200) {
        const upBody = await upResp.clone().json().catch(() => ({})) as { item?: { name?: string } };
        void auditLogger?.log({
          event: "media.upload",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "media", id: upBody.item?.name },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return upResp;
    }

    // DELETE /admin/api/media — Delete a media file
    if (adminPath === "/api/media" && method === "DELETE") {
      requirePermission(authResult, "media.delete");
      // Clone req body to extract filename for audit before it's consumed
      const delMediaReq = req.clone();
      const dmResp = await handleDeleteMedia(req);
      if (dmResp.status === 200) {
        const dmBody = await delMediaReq.json().catch(() => ({})) as { name?: string };
        void auditLogger?.log({
          event: "media.delete",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "media", id: dmBody.name },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return dmResp;
    }

    // PUT /admin/api/media/meta — Save media sidecar metadata (e.g. focal point)
    if (adminPath === "/api/media/meta" && method === "PUT") {
      requirePermission(authResult, "media.upload");
      return handleSaveMediaMeta(req);
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
      const cuResp = await handleCreateUser(req, authResult);
      if (cuResp.status === 201) {
        const cuBody = await cuResp.clone().json().catch(() => ({})) as { user?: { id?: string } };
        void auditLogger?.log({
          event: "user.create",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "user", id: cuBody.user?.id },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return cuResp;
    }

    // PUT /admin/api/users/:id — Update user (role, name, email, enabled)
    if (adminPath.startsWith("/api/users/") && !adminPath.endsWith("/password") && method === "PUT") {
      requirePermission(authResult, "users.update");
      const userId = adminPath.replace("/api/users/", "");
      const uuResp = await handleUpdateUser(req, userId, authResult);
      if (uuResp.status === 200) {
        void auditLogger?.log({
          event: "user.update",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "user", id: userId },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return uuResp;
    }

    // POST /admin/api/users/:id/password — Change a user's password
    if (adminPath.startsWith("/api/users/") && adminPath.endsWith("/password") && method === "POST") {
      requirePermission(authResult, "users.update");
      const userId = adminPath.replace("/api/users/", "").replace("/password", "");
      const pwResp = await handleChangeUserPassword(req, userId);
      if (pwResp.status === 200) {
        void auditLogger?.log({
          event: "user.password",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "user", id: userId },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return pwResp;
    }

    // DELETE /admin/api/users/:id — Delete a user
    if (adminPath.startsWith("/api/users/") && method === "DELETE") {
      requirePermission(authResult, "users.delete");
      const userId = adminPath.replace("/api/users/", "");
      const duResp = await handleDeleteUser(userId, authResult);
      if (duResp.status === 200) {
        void auditLogger?.log({
          event: "user.delete",
          actor: actorFromAuth(authResult),
          ip: getRequestIp(req),
          userAgent: getRequestUa(req),
          target: { type: "user", id: userId },
          detail: {},
          outcome: "success",
        }).catch(() => {});
      }
      return duResp;
    }

    // GET /admin/api/config — Read site config
    if (adminPath === "/api/config" && method === "GET") {
      requirePermission(authResult, "config.read");
      const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
      return jsonResponse({ title, description, url: siteUrl, author, metadata, taxonomies });
    }

    // === Theme API routes ===

    // GET /admin/api/config/themes — List available themes + current theme
    if (adminPath === "/api/config/themes" && method === "GET") {
      requirePermission(authResult, "config.read");
      const themes = await engine.getAvailableThemes();
      return jsonResponse({ themes, current: engine.config.theme.name });
    }

    // PUT /admin/api/config/theme — Switch active theme
    if (adminPath === "/api/config/theme" && method === "PUT") {
      requirePermission(authResult, "config.update");
      try {
        const body = await req.json() as { name?: string };
        if (!body.name || typeof body.name !== "string") {
          return jsonResponse({ error: "Theme name required" }, 400);
        }
        const available = await engine.getAvailableThemes();
        if (!available.includes(body.name)) {
          return jsonResponse({ error: `Theme "${body.name}" not found` }, 404);
        }
        await engine.switchTheme(body.name);
        return jsonResponse({ switched: true, theme: body.name });
      } catch (err) {
        return serverError(err);
      }
    }

    // GET /admin/api/config/theme-config — Read theme config + schema
    if (adminPath === "/api/config/theme-config" && method === "GET") {
      requirePermission(authResult, "config.read");
      const manifest = engine.themes.theme.manifest;
      return jsonResponse({
        themeName: engine.config.theme.name,
        schema: manifest.configSchema ?? {},
        config: engine.themeConfig,
      });
    }

    // PUT /admin/api/config/theme-config — Save theme config
    if (adminPath === "/api/config/theme-config" && method === "PUT") {
      requirePermission(authResult, "config.update");
      try {
        const body = await req.json() as Record<string, unknown>;
        const manifest = engine.themes.theme.manifest;
        const schema = manifest.configSchema;

        // Validate and coerce against configSchema if present
        if (schema && typeof schema === "object" && !Array.isArray(schema)) {
          const schemaRecord = schema as Record<string, import("../blueprints/types.ts").BlueprintField>;
          const errors: string[] = [];
          for (const [key, field] of Object.entries(schemaRecord)) {
            if (field.type === "number" && body[key] !== undefined && body[key] !== null) {
              const n = Number(body[key]);
              body[key] = isNaN(n) ? body[key] : n;
            } else if (field.type === "toggle") {
              body[key] = body[key] === true || body[key] === "true";
            }
            if (field.required && (body[key] === undefined || body[key] === null || body[key] === "")) {
              errors.push(field.label ?? key);
            }
          }
          if (errors.length > 0) {
            return jsonResponse({ error: `Missing required fields: ${errors.join(", ")}` }, 422);
          }
        }

        const dataDir = config.config.admin?.dataDir ?? "data";
        const themeConfigPath = `${dataDir}/theme-config.json`;
        await storage.write(themeConfigPath, new TextEncoder().encode(JSON.stringify(body, null, 2)));

        // Update engine's in-memory themeConfig
        Object.assign(engine.themeConfig, body);
        // Remove any keys no longer in body (full replace semantics)
        for (const key of Object.keys(engine.themeConfig)) {
          if (!(key in body)) delete engine.themeConfig[key];
        }

        return jsonResponse({ saved: true });
      } catch (err) {
        return serverError(err);
      }
    }

    // GET /admin/api/theme-preview — Render a page using a preview theme (does not switch)
    if (adminPath === "/api/theme-preview" && method === "GET") {
      requirePermission(authResult, "config.read");
      return handleThemePreview(new URL(req.url));
    }

    // GET /admin/api/registry/themes — Return the bundled theme registry JSON
    if (adminPath === "/api/registry/themes" && method === "GET") {
      requirePermission(authResult, "config.read");
      return handleThemeRegistry();
    }

    // POST /admin/api/themes/install — Download + extract a theme ZIP from a registry URL
    if (adminPath === "/api/themes/install" && method === "POST") {
      requirePermission(authResult, "config.update");
      return handleThemeInstall(req);
    }

    // === Plugin API routes ===

    // GET /admin/api/plugins — List registered plugins and their configs
    if (adminPath === "/api/plugins" && method === "GET") {
      const plugins = hooks?.plugins() ?? [];
      return jsonResponse({
        items: plugins.map((p) => ({
          name: p.name,
          version: p.version,
          description: p.description,
          author: p.author,
          hooks: Object.keys(p.hooks),
          hasConfigSchema: !!(p.configSchema && Object.keys(p.configSchema).length > 0),
          config: config.config.plugins[p.name] ?? {},
        })),
        total: plugins.length,
      });
    }

    // PUT /admin/api/plugins/:name/config — Save plugin config
    if (adminPath.startsWith("/api/plugins/") && adminPath.endsWith("/config") && method === "PUT") {
      requirePermission(authResult, "config.update");
      const pluginName = decodeURIComponent(
        adminPath.slice("/api/plugins/".length, -"/config".length),
      );
      if (!pluginName) return jsonResponse({ error: "Plugin name required" }, 400);

      // Verify plugin is registered
      const plugin = hooks?.plugins().find((p) => p.name === pluginName);
      if (!plugin) return jsonResponse({ error: "Plugin not found" }, 404);

      return handleSavePluginConfig(req, pluginName, plugin.configSchema);
    }

    // === Workflow API routes ===

    // POST /admin/api/workflow/transition — Change page status
    if (adminPath === "/api/workflow/transition" && method === "POST") {
      requirePermission(authResult, "pages.update");
      return handleWorkflowTransition(req, authResult);
    }

    // GET /admin/api/workflow/status/:path — Get workflow status
    if (adminPath.startsWith("/api/workflow/status/") && method === "GET") {
      requirePermission(authResult, "pages.read");
      const pagePath = decodeURIComponent(adminPath.replace("/api/workflow/status/", ""));
      return handleGetWorkflowStatus(pagePath, authResult);
    }

    // GET /admin/api/workflow/stages — List workflow stages (no auth required)
    if (adminPath === "/api/workflow/stages" && method === "GET") {
      return handleGetWorkflowStages();
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

    // === Staging API routes ===

    if (adminPath.startsWith("/api/staging/")) {
      const stagingRest = adminPath.replace("/api/staging/", "");

      // POST /admin/api/staging/:path/publish
      if (method === "POST" && stagingRest.endsWith("/publish")) {
        requirePermission(authResult, "pages.update");
        const pagePath = decodeURIComponent(stagingRest.replace("/publish", ""));
        return handleStagingPublish(pagePath, authResult);
      }

      // POST /admin/api/staging/:path — upsert draft
      if (method === "POST") {
        requirePermission(authResult, "pages.update");
        const pagePath = decodeURIComponent(stagingRest);
        return handleStagingUpsert(req, pagePath, authResult);
      }

      // GET /admin/api/staging/:path — get draft
      if (method === "GET") {
        requirePermission(authResult, "pages.read");
        const pagePath = decodeURIComponent(stagingRest);
        return handleStagingGet(pagePath);
      }

      // DELETE /admin/api/staging/:path — discard draft
      if (method === "DELETE") {
        requirePermission(authResult, "pages.update");
        const pagePath = decodeURIComponent(stagingRest);
        return handleStagingDiscard(pagePath);
      }
    }

    // === Flex Object API routes ===

    if (adminPath.startsWith("/api/flex/")) {
      const flexParts = adminPath.split("/"); // ["", "api", "flex", type?, id?]

      // GET /admin/api/flex/:type — list records
      if (flexParts.length === 4 && method === "GET") {
        const type = decodeURIComponent(flexParts[3]);
        return handleFlexApiList(type);
      }

      // GET /admin/api/flex/:type/:id — single record
      if (flexParts.length === 5 && method === "GET") {
        const type = decodeURIComponent(flexParts[3]);
        const id = decodeURIComponent(flexParts[4]);
        return handleFlexApiGet(type, id);
      }

      // POST /admin/api/flex/:type — create record
      if (flexParts.length === 4 && method === "POST") {
        const type = decodeURIComponent(flexParts[3]);
        return handleFlexApiCreate(type, req);
      }

      // PUT /admin/api/flex/:type/:id — update record
      if (flexParts.length === 5 && method === "PUT") {
        const type = decodeURIComponent(flexParts[3]);
        const id = decodeURIComponent(flexParts[4]);
        return handleFlexApiUpdate(type, id, req);
      }

      // DELETE /admin/api/flex/:type/:id — delete record
      if (flexParts.length === 5 && method === "DELETE") {
        const type = decodeURIComponent(flexParts[3]);
        const id = decodeURIComponent(flexParts[4]);
        return handleFlexApiDelete(type, id);
      }
    }

    // === Webhook delivery logs ===

    // GET /admin/api/webhooks/deliveries
    if (adminPath === "/api/webhooks/deliveries" && method === "GET") {
      requirePermission(authResult, "pages.read");
      const runtimeDir = config.config.admin?.runtimeDir ?? ".dune/admin";
      const logs = await listDeliveryLogs(runtimeDir);
      return jsonResponse({ items: logs, total: logs.length });
    }

    // === Search analytics ===

    // GET /admin/api/search/analytics
    if (adminPath === "/api/search/analytics" && method === "GET") {
      requirePermission(authResult, "pages.read");
      const runtimeDir = config.config.admin?.runtimeDir ?? ".dune/admin";
      const analyticsPath = join(runtimeDir, "search-analytics.jsonl");
      const summary = await createSearchAnalytics(analyticsPath).summarize();
      return jsonResponse(summary);
    }

    // === Audit log API ===

    // GET /admin/api/audit — Query audit log (admin only)
    if (adminPath === "/api/audit" && method === "GET") {
      if (authResult.user?.role !== "admin") {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
      if (!auditLogger) {
        return jsonResponse({ error: "Audit logging not enabled" }, 501);
      }
      const auditUrl = new URL(req.url);
      const auditQuery: import("../audit/mod.ts").AuditQuery = {};
      const limitParam = auditUrl.searchParams.get("limit");
      const offsetParam = auditUrl.searchParams.get("offset");
      const eventParam = auditUrl.searchParams.get("event");
      const actorIdParam = auditUrl.searchParams.get("actorId");
      const fromParam = auditUrl.searchParams.get("from");
      const toParam = auditUrl.searchParams.get("to");
      const outcomeParam = auditUrl.searchParams.get("outcome");
      if (limitParam) auditQuery.limit = parseInt(limitParam, 10);
      if (offsetParam) auditQuery.offset = parseInt(offsetParam, 10);
      if (eventParam) auditQuery.event = eventParam as import("../audit/mod.ts").AuditEventType;
      if (actorIdParam) auditQuery.actorId = actorIdParam;
      if (fromParam) auditQuery.from = fromParam;
      if (toParam) auditQuery.to = toParam;
      if (outcomeParam && (outcomeParam === "success" || outcomeParam === "failure")) {
        auditQuery.outcome = outcomeParam;
      }
      const result = await auditLogger.query(auditQuery);
      return jsonResponse(result);
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
      const { path: pagePath, title, content, template, format, file, file_url } = body;

      if (!pagePath || !title) {
        return jsonResponse({ error: "path and title are required" }, 400);
      }

      if (!validatePagePath(pagePath)) {
        return jsonResponse({ error: "Invalid page path: must not contain '..' or absolute segments" }, 400);
      }

      const ext = format === "mdx" ? ".mdx" : format === "tsx" ? ".tsx" : ".md";

      // Build frontmatter — include file/file_url when this is a file-type page
      let fm = `---\ntitle: "${title}"\ntemplate: ${template ?? "default"}\npublished: true\n`;
      if (file && typeof file === "string") fm += `file: "${file}"\n`;
      if (file_url && typeof file_url === "string") fm += `file_url: "${file_url}"\n`;
      fm += `---\n`;

      // Default content: for file pages embed a download link; otherwise blank
      const defaultContent = (file_url && typeof file_url === "string")
        ? `[⬇ ${title}](${file_url})\n`
        : (content ?? "");

      const fullContent = fm + "\n" + defaultContent;

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${pagePath}/default${ext}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));

      // Rebuild the engine
      await engine.rebuild();

      // Fire content hooks + outbound webhooks (fire-and-forget)
      const webhookEndpoints = config.config.admin?.webhooks ?? [];
      const runtimeDir = config.config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) {
        hooks.fire("onPageCreate", { sourcePath: `${pagePath}/default${ext}`, title }).catch(() => {});
      }
      fireContentWebhooks(webhookEndpoints, "onPageCreate", { sourcePath: `${pagePath}/default${ext}`, title }, runtimeDir);

      return jsonResponse({ created: true, path: pagePath, file: filePath }, 201);
    } catch (err) {
      return serverError(err);
    }
  }

  /**
   * Run `git add <file> && git commit -m "..."` after a page save.
   * Fire-and-forget: errors are logged but never surfaced to the client.
   * Only runs when `admin.git_commit: true` in site.yaml and git is available.
   */
  async function maybeGitCommit(filePath: string, sourcePath: string, author?: string): Promise<void> {
    if (!config.config.admin?.git_commit) return;
    try {
      const msg = author
        ? `Admin: update ${sourcePath} (by ${author})`
        : `Admin: update ${sourcePath}`;
      const add = new Deno.Command("git", { args: ["add", filePath], stderr: "inherit" });
      await add.output();
      const commit = new Deno.Command("git", {
        args: ["commit", "-m", msg],
        stderr: "inherit",
        stdout: "null",
      });
      await commit.output();
    } catch (err) {
      console.warn(`[dune] git commit failed: ${err instanceof Error ? err.message : err}`);
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

      // Update frontmatter if provided.
      // Merge incoming fields over the existing frontmatter so custom fields
      // (taxonomy, descriptor, metadata, collection, etc.) are never silently
      // dropped when the editor only knows about a subset of fields.
      if (fm) {
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
        const existingFm = fmMatch
          ? (parseYaml(fmMatch[1]) as Record<string, unknown> ?? {})
          : {};
        const mergedFm = { ...existingFm, ...fm };

        // Blueprint validation: if the page's template has a blueprint, validate
        // the merged frontmatter and return structured errors instead of saving.
        const template = (mergedFm.template as string) ?? page.template;
        if (engine.blueprints[template]) {
          const errors = validateFrontmatter(
            mergedFm as import("../content/types.ts").PageFrontmatter,
            template,
            engine.blueprints,
          );
          if (errors.length > 0) {
            return jsonResponse(
              { error: "Blueprint validation failed", validationErrors: errors },
              422,
            );
          }
        }

        const yamlFm = stringifyYaml(mergedFm).trimEnd();
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

      // Git auto-commit if enabled
      await maybeGitCommit(filePath, pagePath, undefined);

      // Fire content hooks + outbound webhooks (fire-and-forget)
      const webhookEndpoints = config.config.admin?.webhooks ?? [];
      const runtimeDir = config.config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) {
        hooks.fire("onPageUpdate", { sourcePath: page.sourcePath }).catch(() => {});
      }
      fireContentWebhooks(webhookEndpoints, "onPageUpdate", { sourcePath: page.sourcePath }, runtimeDir);

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

      // Fire content hooks + outbound webhooks (fire-and-forget)
      const webhookEndpointsDel = config.config.admin?.webhooks ?? [];
      const runtimeDirDel = config.config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) {
        hooks.fire("onPageDelete", { sourcePath: page.sourcePath }).catch(() => {});
      }
      fireContentWebhooks(webhookEndpointsDel, "onPageDelete", { sourcePath: page.sourcePath }, runtimeDirDel);

      return jsonResponse({ deleted: true, sourcePath: page.sourcePath });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleReorderPage(req: Request): Promise<Response> {
    try {
      const body = await req.json() as {
        sourcePath: string;
        targetPath: string | null;
        position?: "before" | "after";
      };
      const { sourcePath, targetPath } = body;
      const position = body.position ?? "before";

      if (!sourcePath) return jsonResponse({ error: "sourcePath required" }, 400);
      if (!validatePagePath(sourcePath)) return jsonResponse({ error: "Invalid sourcePath" }, 400);
      if (targetPath && !validatePagePath(targetPath)) return jsonResponse({ error: "Invalid targetPath" }, 400);

      const source = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!source) return jsonResponse({ error: "Source page not found" }, 404);
      if (source.order === 0) return jsonResponse({ error: "Source page has no numeric prefix and cannot be reordered" }, 400);

      const target = targetPath ? engine.pages.find((p) => p.sourcePath === targetPath) : null;
      if (targetPath && !target) return jsonResponse({ error: "Target page not found" }, 404);
      if (target && source.parentPath !== target.parentPath) {
        return jsonResponse({ error: "Pages must be siblings" }, 400);
      }

      // Find all ordered siblings (same parent, same depth, with numeric prefix)
      const siblings = engine.pages
        .filter((p) => p.parentPath === source.parentPath && p.depth === source.depth && p.order > 0)
        .sort((a, b) => a.order - b.order);

      // Compute new ordering
      const newOrder = siblings.filter((p) => p.sourcePath !== sourcePath);
      let insertIdx: number;
      if (!target) {
        insertIdx = newOrder.length;
      } else {
        const tgtIdx = newOrder.findIndex((p) => p.sourcePath === targetPath);
        insertIdx = position === "after" ? tgtIdx + 1 : tgtIdx;
      }
      if (insertIdx < 0 || insertIdx > newOrder.length) insertIdx = newOrder.length;
      newOrder.splice(insertIdx, 0, source);

      const contentDir = config.config.system.content.dir;

      // Collect all renames needed (pages whose numeric prefix changes)
      const renames: Array<{ oldDir: string; newDir: string }> = [];
      for (let i = 0; i < newOrder.length; i++) {
        const page = newOrder[i];
        const newNum = i + 1;
        if (page.order === newNum) continue; // already in correct position

        const fullPath = `${contentDir}/${page.sourcePath}`;
        const oldDir = dirname(fullPath);
        const folderName = basename(oldDir);
        const match = folderName.match(/^(\d+)\.(.*)/);
        if (!match) continue; // no numeric prefix — skip

        const slug = match[2];
        const newFolderName = String(newNum).padStart(2, "0") + "." + slug;
        const parentDir = dirname(oldDir);
        const newDir = `${parentDir}/${newFolderName}`;
        renames.push({ oldDir, newDir });
      }

      if (renames.length === 0) {
        return jsonResponse({ reordered: true }); // already in order
      }

      // Two-phase rename to avoid conflicts (e.g., 01→02 and 02→01 would collide on a
      // case-insensitive filesystem). Phase 1: rename to temp names. Phase 2: rename to final names.
      // Use a timestamp suffix so concurrent requests don't collide.
      const tmpSuffix = `__reorder_${Date.now()}__`;
      const tempRenames: Array<{ tmpDir: string; newDir: string }> = [];

      for (const r of renames) {
        const tmpDir = r.oldDir + tmpSuffix;
        await storage.rename(r.oldDir, tmpDir);
        tempRenames.push({ tmpDir, newDir: r.newDir });
      }
      for (const r of tempRenames) {
        await storage.rename(r.tmpDir, r.newDir);
      }

      await engine.rebuild();
      return jsonResponse({ reordered: true });
    } catch (err) {
      return serverError(err, "reorder-page");
    }
  }

  // === Translation creation handler ===

  async function handleCreateTranslation(req: Request): Promise<Response> {
    try {
      const { sourcePath, lang } = await req.json();
      const supportedLangs = engine.config.system.languages?.supported ?? [];

      if (!sourcePath || typeof sourcePath !== "string" || !lang || typeof lang !== "string") {
        return jsonResponse({ error: "sourcePath and lang required" }, 400);
      }
      if (!supportedLangs.includes(lang)) {
        return jsonResponse({ error: "Unsupported language" }, 400);
      }

      const dir = dirname(sourcePath);
      const filename = basename(sourcePath);
      const fileInfo = parseContentFilename(filename, supportedLangs);
      if (!fileInfo) return jsonResponse({ error: "Cannot parse source path" }, 400);

      const contentDir = config.config.system.content.dir;
      const targetPath = `${dir}/${fileInfo.template}.${lang}${fileInfo.ext}`;

      // Refuse to overwrite an existing translation
      if (engine.pages.some((p) => p.sourcePath === targetPath)) {
        return jsonResponse({ error: "Translation already exists" }, 409);
      }

      // Copy source content verbatim to the new language file
      const sourceFullPath = `${contentDir}/${sourcePath}`;
      const sourceBytes = await storage.read(sourceFullPath);
      await storage.write(`${contentDir}/${targetPath}`, sourceBytes);
      await engine.rebuild();

      return jsonResponse({ created: true, path: targetPath });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Translation Memory handlers ===

  /** Validate a language code against the configured supported languages. */
  function isValidLang(lang: unknown): lang is string {
    const supported = config.config.system.languages?.supported ?? [];
    return typeof lang === "string" && supported.includes(lang);
  }

  async function renderTMAdminPage(
    pfx: string,
    url: URL,
    authResult: AuthResult,
  ): Promise<string> {
    const userName = authResult.user?.name ?? "Admin";
    const languages = config.config.system.languages?.supported ?? [];
    const defaultLang = config.config.system.languages?.default ?? "en";
    const otherLangs = languages.filter((l: string) => l !== defaultLang);

    // Determine which language pair to show
    const from = url.searchParams.get("from") ?? defaultLang;
    const to = url.searchParams.get("to") ?? otherLangs[0] ?? "";

    let entries: Array<{ source: string; target: string }> = [];
    if (from && to && isValidLang(from) && isValidLang(to)) {
      const contentDir = config.config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      entries = Object.entries(tm)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, target]) => ({ source, target }));
    }

    const tmData: TMPageData = { languages, defaultLanguage: defaultLang, from, to, entries };
    const content = renderTMPage(pfx, tmData);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Translation Memory — Dune Admin</title>
  <style>${baseAdminStyles()}${translationStatusStyles()}${tmPageStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "i18n", userName, `
    <h2>Translation Memory</h2>
    <p class="tm-intro">TM stores previously translated segments and suggests them when you translate new pages. Use <strong>Rebuild</strong> to populate from your existing translated pages.</p>
    ${content}
  `)}
</body>
</html>`;
  }

  async function handleListTM(url: URL): Promise<Response> {
    try {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!isValidLang(from) || !isValidLang(to)) {
        return jsonResponse({ error: "Valid from and to language codes required" }, 400);
      }
      const contentDir = config.config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      const entries = Object.entries(tm)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, target]) => ({ source, target }));
      return jsonResponse({ from, to, entries });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleAddTMEntry(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { from, to, source, target } = body;
      if (!isValidLang(from) || !isValidLang(to)) {
        return jsonResponse({ error: "Valid from and to language codes required" }, 400);
      }
      if (!source || typeof source !== "string" || !target || typeof target !== "string") {
        return jsonResponse({ error: "source and target strings required" }, 400);
      }
      const contentDir = config.config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      tm[source.trim()] = target.trim();
      await saveTM(storage, contentDir, from, to, tm);
      return jsonResponse({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleDeleteTMEntry(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { from, to, source } = body;
      if (!isValidLang(from) || !isValidLang(to)) {
        return jsonResponse({ error: "Valid from and to language codes required" }, 400);
      }
      if (!source || typeof source !== "string") {
        return jsonResponse({ error: "source string required" }, 400);
      }
      const contentDir = config.config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      delete tm[source];
      await saveTM(storage, contentDir, from, to, tm);
      return jsonResponse({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleRebuildTM(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { from, to } = body;
      if (!isValidLang(from) || !isValidLang(to)) {
        return jsonResponse({ error: "Valid from and to language codes required" }, 400);
      }

      const contentDir = config.config.system.content.dir;
      const supportedLangs = config.config.system.languages?.supported ?? [];

      // Load existing TM so we can merge new pairs without losing manual entries
      const tm = await loadTM(storage, contentDir, from, to);
      let added = 0;

      // For each default-language page, look for a target-language sibling
      const sourceLangPages = engine.pages.filter((p) => p.language === from);
      for (const sourcePage of sourceLangPages) {
        const filename = basename(sourcePage.sourcePath);
        const fileInfo = parseContentFilename(filename, supportedLangs);
        if (!fileInfo) continue;

        const dir = dirname(sourcePage.sourcePath);
        const targetPath = `${dir}/${fileInfo.template}.${to}${fileInfo.ext}`;
        const targetExists = engine.pages.some((p) => p.sourcePath === targetPath);
        if (!targetExists) continue;

        try {
          const [sourceLoaded, targetLoaded] = await Promise.all([
            engine.loadPage(sourcePage.sourcePath),
            engine.loadPage(targetPath),
          ]);

          if (!sourceLoaded.rawContent || !targetLoaded.rawContent) continue;

          const pairs = buildTMFromPages(sourceLoaded.rawContent, targetLoaded.rawContent);
          for (const [src, tgt] of Object.entries(pairs)) {
            if (!tm[src]) {
              tm[src] = tgt;
              added++;
            }
          }
        } catch {
          // Skip pages that can't be loaded
        }
      }

      await saveTM(storage, contentDir, from, to, tm);
      return jsonResponse({ ok: true, added });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Machine Translation handlers ===

  function handleMTStatus(): Response {
    const enabled = mt != null;
    return jsonResponse({ enabled, provider: enabled ? mt!.provider : null });
  }

  /** Split a file's content into a frontmatter block and body. */
  function splitFrontmatter(content: string): { fm: string; body: string } {
    if (!content.startsWith("---")) return { fm: "", body: content };
    const end = content.indexOf("\n---", 3);
    if (end === -1) return { fm: "", body: content };
    return { fm: content.slice(0, end + 4), body: content.slice(end + 4) };
  }

  async function handleMachineTranslatePage(req: Request): Promise<Response> {
    if (!mt) {
      return jsonResponse({ error: "Machine translation not configured" }, 501);
    }
    try {
      const { sourcePath, targetLang } = await req.json();
      if (!sourcePath || typeof sourcePath !== "string" || !targetLang || typeof targetLang !== "string") {
        return jsonResponse({ error: "sourcePath and targetLang required" }, 400);
      }

      const supportedLangs = config.config.system.languages?.supported ?? [];
      if (!supportedLangs.includes(targetLang)) {
        return jsonResponse({ error: "Unsupported target language" }, 400);
      }

      const defaultLang = config.config.system.languages?.default ?? "en";
      const contentDir = config.config.system.content.dir;

      // Read the source file
      let sourceText: string;
      try {
        sourceText = await storage.readText(`${contentDir}/${sourcePath}`);
      } catch {
        return jsonResponse({ error: "Source file not found" }, 404);
      }

      const { fm, body } = splitFrontmatter(sourceText);

      // Translate the body
      let translatedBody: string;
      try {
        translatedBody = await mt.translate(body, defaultLang, targetLang);
      } catch (err) {
        return jsonResponse({ error: `Translation failed: ${err}` }, 502);
      }

      // Translate the title in frontmatter if present
      let translatedFm = fm;
      const titleMatch = fm.match(/^(title:\s*["']?)(.+?)(["']?\s*)$/m);
      if (titleMatch) {
        let translatedTitle: string;
        try {
          translatedTitle = await mt.translate(titleMatch[2], defaultLang, targetLang);
        } catch (err) {
          return jsonResponse({ error: `Title translation failed: ${err}` }, 502);
        }
        translatedFm = fm.replace(
          /^(title:\s*["']?)(.+?)(["']?\s*)$/m,
          (_: string, pre: string, _val: string, post: string) => pre + translatedTitle + post,
        );
      }

      const newContent = translatedFm + translatedBody;

      // Derive target path: replace `.md` with `.{targetLang}.md` (handle existing lang suffixes)
      // Pattern: `file.md` → `file.{lang}.md`, `file.en.md` → `file.{lang}.md`
      const langPattern = supportedLangs.join("|");
      const existingLangRegex = new RegExp(`\\.(${langPattern})\\.(md|mdx|tsx)$`);
      let targetPath: string;
      if (existingLangRegex.test(sourcePath)) {
        targetPath = sourcePath.replace(existingLangRegex, `.${targetLang}.$2`);
      } else {
        targetPath = sourcePath.replace(/\.(md|mdx|tsx)$/, `.${targetLang}.$1`);
      }

      await storage.write(`${contentDir}/${targetPath}`, new TextEncoder().encode(newContent));

      // Fire-and-forget rebuild
      engine.rebuild().catch((err: unknown) => {
        console.error("[dune] MT translate-page rebuild error:", err);
      });

      return jsonResponse({ ok: true, targetPath });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleMachineTranslateSegment(req: Request): Promise<Response> {
    if (!mt) {
      return jsonResponse({ error: "Machine translation not configured" }, 501);
    }
    try {
      const body = await req.json();
      const { text, from, to } = body;
      if (!text || typeof text !== "string" || !from || typeof from !== "string" || !to || typeof to !== "string") {
        return jsonResponse({ error: "text, from, and to are required" }, 400);
      }

      let translation: string;
      try {
        translation = await mt.translate(text, from, to);
      } catch (err) {
        return jsonResponse({ error: `Translation failed: ${err}` }, 502);
      }

      return jsonResponse({ ok: true, translation });
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
        meta: Record<string, unknown>;
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
              meta: media.meta,
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

  // === Media meta handler ===

  async function handleSaveMediaMeta(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { pagePath, name, focal } = body;

      if (!pagePath || typeof pagePath !== "string" || !name || typeof name !== "string") {
        return jsonResponse({ error: "pagePath and name required" }, 400);
      }

      // Validate focal: null clears it; otherwise must be [x, y] with values 0–100
      if (focal !== null && focal !== undefined) {
        if (
          !Array.isArray(focal) || focal.length !== 2 ||
          typeof focal[0] !== "number" || typeof focal[1] !== "number" ||
          focal[0] < 0 || focal[0] > 100 || focal[1] < 0 || focal[1] > 100
        ) {
          return jsonResponse({ error: "focal must be [x, y] with values 0–100 or null" }, 400);
        }
      }

      // Derive sidecar path server-side — client never constructs paths directly
      const contentDir = config.config.system.content.dir;
      const sidecarPath = `${contentDir}/${dirname(pagePath)}/${name}.meta.yaml`;

      if (focal === null || focal === undefined) {
        // Clear focal: read existing meta, remove focal key
        let existing: Record<string, unknown> = {};
        try {
          const raw = await storage.read(sidecarPath);
          existing = (parseYaml(new TextDecoder().decode(raw)) as Record<string, unknown>) ?? {};
        } catch {
          // Sidecar doesn't exist — nothing to clear
          return jsonResponse({ ok: true });
        }
        delete existing.focal;
        if (Object.keys(existing).length === 0) {
          // No remaining meta — remove sidecar entirely
          try {
            await storage.delete(sidecarPath);
          } catch {
            // Already gone — fine
          }
        } else {
          await storage.write(sidecarPath, new TextEncoder().encode(stringifyYaml(existing)));
        }
      } else {
        // Merge focal into existing meta (preserves other fields)
        let existing: Record<string, unknown> = {};
        try {
          const raw = await storage.read(sidecarPath);
          existing = (parseYaml(new TextDecoder().decode(raw)) as Record<string, unknown>) ?? {};
        } catch {
          // Sidecar doesn't exist — start fresh
        }
        existing.focal = focal;
        await storage.write(sidecarPath, new TextEncoder().encode(stringifyYaml(existing)));
      }

      return jsonResponse({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Media upload handler ===

  async function handleUploadMedia(req: Request): Promise<Response> {
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      const pagePath = formData.get("pagePath");

      if (!file || !(file instanceof File)) {
        return jsonResponse({ error: "file required" }, 400);
      }
      if (!pagePath || typeof pagePath !== "string") {
        return jsonResponse({ error: "pagePath required" }, 400);
      }

      // Sanitize filename — strip path components, replace unsafe chars
      const rawName = file.name;
      const safeName = rawName
        .replace(/[/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 200);

      if (!safeName || !isMediaFile(safeName)) {
        return jsonResponse({ error: "unsupported file type" }, 400);
      }
      if (file.size > MAX_FILE_SIZE) {
        return jsonResponse({ error: "file too large (max 50 MB)" }, 400);
      }

      // Validate pagePath — must not escape content dir
      const contentDir = config.config.system.content.dir;
      const pageDir = dirname(pagePath);
      if (pageDir.includes("..") || pagePath.includes("..")) {
        return jsonResponse({ error: "invalid pagePath" }, 400);
      }

      const destPath = `${contentDir}/${pageDir}/${safeName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await storage.write(destPath, bytes);

      const url = `/content-media/${pageDir}/${safeName}`;
      const mimeType = getMimeType(safeName);
      return jsonResponse({
        ok: true,
        item: { name: safeName, url, type: mimeType, size: bytes.length, pagePath },
      });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Media delete handler ===

  async function handleDeleteMedia(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { pagePath, name } = body;

      if (!pagePath || typeof pagePath !== "string" || !name || typeof name !== "string") {
        return jsonResponse({ error: "pagePath and name required" }, 400);
      }
      if (pagePath.includes("..") || name.includes("..") || name.includes("/") || name.includes("\\")) {
        return jsonResponse({ error: "invalid path" }, 400);
      }
      if (!isMediaFile(name)) {
        return jsonResponse({ error: "not a media file" }, 400);
      }

      const contentDir = config.config.system.content.dir;
      const pageDir = dirname(pagePath);
      const filePath = `${contentDir}/${pageDir}/${name}`;

      await storage.delete(filePath);

      // Remove sidecar if present
      const sidecarPath = `${filePath}.meta.yaml`;
      try {
        if (await storage.exists(sidecarPath)) {
          await storage.delete(sidecarPath);
        }
      } catch { /* ignore */ }

      return jsonResponse({ ok: true });
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

  async function handleUpdateUser(req: Request, userId: string, authResult: AuthResult): Promise<Response> {
    try {
      const body = await req.json();
      const { name, email, role, enabled } = body;

      // Only admins may change roles
      if (role !== undefined && authResult.user?.role !== "admin") {
        return jsonResponse({ error: "Only admins can change user roles" }, 403);
      }
      // Only admins may change another user's role to admin
      if (role === "admin" && authResult.user?.role !== "admin") {
        return jsonResponse({ error: "Only admins can assign admin role" }, 403);
      }
      // Validate role if provided
      if (role !== undefined) {
        const VALID_ROLES = ["admin", "editor", "author"] as const;
        if (!VALID_ROLES.includes(role)) {
          return jsonResponse({ error: "Invalid role" }, 400);
        }
      }

      const updates: Partial<{ name: string; email: string; role: "admin" | "editor" | "author"; enabled: boolean }> = {};
      if (name !== undefined) updates.name = String(name);
      if (email !== undefined) updates.email = String(email);
      if (role !== undefined) updates.role = role;
      if (enabled !== undefined) updates.enabled = Boolean(enabled);

      const updated = await users.update(userId, updates);
      if (!updated) return jsonResponse({ error: "User not found" }, 404);
      return jsonResponse({ ok: true, user: toUserInfo(updated) });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleChangeUserPassword(req: Request, userId: string): Promise<Response> {
    try {
      const { password } = await req.json();
      if (!password || typeof password !== "string") {
        return jsonResponse({ error: "password is required" }, 400);
      }
      const MIN_PASSWORD_LENGTH = 12;
      if (password.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      }
      const changed = await users.changePassword(userId, password);
      if (!changed) return jsonResponse({ error: "User not found" }, 404);
      return jsonResponse({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleDeleteUser(userId: string, authResult: AuthResult): Promise<Response> {
    try {
      // Prevent self-deletion
      if (authResult.user?.id === userId) {
        return jsonResponse({ error: "Cannot delete your own account" }, 400);
      }
      const deleted = await users.delete(userId);
      if (!deleted) return jsonResponse({ error: "User not found" }, 404);
      return jsonResponse({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  }

  async function renderUsersPageHtml(pfx: string, authResult: AuthResult): Promise<string> {
    const userName = authResult.user?.name ?? "Admin";
    const isAdmin = authResult.user?.role === "admin";
    const allUsers = await users.list();
    const data: UsersPageData = {
      users: allUsers.map(toUserInfo),
      currentUserId: authResult.user?.id ?? "",
      isAdmin,
    };
    const content = renderUsersPage(pfx, data);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Users — Dune Admin</title>
  <style>${baseAdminStyles()}${userStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "users", userName, `
    <h2>Users</h2>
    ${content}
  `)}
</body>
</html>`;
  }

  // === Audit log page handler ===

  async function handleAuditPage(url: URL, authResult: AuthResult): Promise<Response> {
    const userName = authResult.user?.name ?? "Admin";
    const eventFilter = url.searchParams.get("event") ?? "";
    const actorIdFilter = url.searchParams.get("actorId") ?? "";

    if (!auditLogger) {
      return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Audit Log — Dune Admin</title>
  <style>${baseAdminStyles()}</style>
</head>
<body>
  ${adminShell(prefix, "audit", userName, `
    <h2>Audit Log</h2>
    <p style="color:#888;padding:2rem 0">Audit logging is not enabled.</p>
  `)}
</body>
</html>`);
    }

    const q: import("../audit/mod.ts").AuditQuery = { limit: 50 };
    if (eventFilter) q.event = eventFilter as import("../audit/mod.ts").AuditEventType;
    if (actorIdFilter) q.actorId = actorIdFilter;
    const result = await auditLogger.query(q);

    const eventOptions: string[] = [
      "auth.login", "auth.logout", "auth.login_failed",
      "page.create", "page.update", "page.delete", "page.publish", "page.workflow",
      "config.update",
      "user.create", "user.update", "user.delete", "user.password",
      "media.upload", "media.delete",
      "plugin.config_update",
      "flex.create", "flex.update", "flex.delete",
      "system.rebuild", "system.cache_purge",
    ];

    const rows = result.entries.map((e) => `
    <tr>
      <td style="white-space:nowrap;font-size:0.8rem;color:#666">${escapeHtml(e.ts.replace("T", " ").slice(0, 19))}</td>
      <td><span class="badge badge-event">${escapeHtml(e.event)}</span></td>
      <td>${e.actor ? escapeHtml(e.actor.username) : '<span style="color:#aaa">—</span>'}</td>
      <td>${e.target ? escapeHtml([e.target.type, e.target.id].filter(Boolean).join(": ")) : '<span style="color:#aaa">—</span>'}</td>
      <td style="font-size:0.8rem;color:#666">${e.ip ? escapeHtml(e.ip) : '<span style="color:#aaa">—</span>'}</td>
      <td><span class="badge ${e.outcome === "success" ? "badge-success" : "badge-failure"}">${escapeHtml(e.outcome)}</span></td>
    </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Audit Log — Dune Admin</title>
  <style>${baseAdminStyles()}
  .audit-filters { display:flex; gap:0.75rem; align-items:center; flex-wrap:wrap; margin-bottom:1rem; }
  .audit-filters select, .audit-filters input { padding:0.4rem 0.6rem; border:1px solid #ddd; border-radius:4px; font-size:0.85rem; }
  .badge-event { background:#e8f0fe; color:#1a56db; font-size:0.75rem; }
  .badge-success { background:#d1fae5; color:#065f46; }
  .badge-failure { background:#fee2e2; color:#991b1b; }
  .audit-count { font-size:0.85rem; color:#666; margin-bottom:0.5rem; }
  </style>
</head>
<body>
  ${adminShell(prefix, "audit", userName, `
    <h2>Audit Log</h2>
    <form method="GET" action="${prefix}/audit" class="audit-filters">
      <select name="event">
        <option value="">All events</option>
        ${eventOptions.map((ev) => `<option value="${escapeHtml(ev)}"${eventFilter === ev ? " selected" : ""}>${escapeHtml(ev)}</option>`).join("")}
      </select>
      <input type="text" name="actorId" placeholder="Actor user ID" value="${escapeHtml(actorIdFilter)}" style="width:220px">
      <button type="submit" class="btn btn-primary btn-sm">Filter</button>
      ${(eventFilter || actorIdFilter) ? `<a href="${prefix}/audit" class="btn btn-outline btn-sm">Clear</a>` : ""}
    </form>
    <p class="audit-count">Showing ${result.entries.length} of ${result.total} entries</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Event</th>
          <th>Actor</th>
          <th>Target</th>
          <th>IP</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:2rem">No entries found</td></tr>'}
      </tbody>
    </table>
  `)}
</body>
</html>`;

    return htmlResponse(html);
  }

  // === Metrics page ===

  function handleMetricsPage(authResult: AuthResult): Response {
    const userName = authResult.user?.name ?? "Admin";

    if (!metrics) {
      return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Performance — Dune Admin</title>
  <style>${baseAdminStyles()}</style>
</head>
<body>
  ${adminShell(prefix, "metrics", userName, `
    <h2>Performance</h2>
    <p style="color:#888;padding:2rem 0">Metrics collection is not enabled.</p>
  `)}
</body>
</html>`);
    }

    const snap = metrics.snapshot();

    const fmtMs = (v: number) => v < 1 ? `${(v * 1000).toFixed(0)}µs` : `${v.toFixed(1)}ms`;
    const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

    const topRoutesRows = snap.topRoutes.length === 0
      ? `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:1.5rem">No requests recorded yet</td></tr>`
      : snap.topRoutes.map((r) => `
        <tr>
          <td style="font-family:monospace;font-size:0.85rem">${escapeHtml(r.route)}</td>
          <td>${r.requests}</td>
          <td>${r.errors > 0 ? `<span style="color:#dc2626">${r.errors}</span>` : "0"}</td>
          <td>${fmtMs(r.latency.p50)}</td>
          <td>${fmtMs(r.latency.p95)}</td>
          <td>${fmtMs(r.latency.p99)}</td>
        </tr>`).join("");

    const slowRows = snap.slowQueries.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#aaa;padding:1.5rem">No slow queries recorded</td></tr>`
      : snap.slowQueries.slice().reverse().map((q) => `
        <tr>
          <td style="font-size:0.8rem;color:#666;white-space:nowrap">${escapeHtml(q.ts.replace("T", " ").slice(0, 19))}</td>
          <td><span class="badge" style="background:#fef3c7;color:#92400e">${escapeHtml(q.type)}</span></td>
          <td style="font-family:monospace;font-size:0.82rem;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(q.query)}</td>
          <td style="color:#dc2626;font-weight:600">${q.durationMs.toFixed(1)}ms</td>
        </tr>`).join("");

    const pageCacheHtml = snap.pageCache
      ? `
        <div class="metrics-card">
          <div class="metrics-card-title">Page Cache</div>
          <div class="metrics-grid">
            <div class="metrics-stat"><div class="metrics-stat-value">${snap.pageCache.entries}</div><div class="metrics-stat-label">Entries</div></div>
            <div class="metrics-stat"><div class="metrics-stat-value">${snap.pageCache.hits}</div><div class="metrics-stat-label">Hits</div></div>
            <div class="metrics-stat"><div class="metrics-stat-value">${snap.pageCache.misses}</div><div class="metrics-stat-label">Misses</div></div>
            <div class="metrics-stat"><div class="metrics-stat-value">${fmtPct(snap.pageCache.hitRate)}</div><div class="metrics-stat-label">Hit Rate</div></div>
            <div class="metrics-stat"><div class="metrics-stat-value">${snap.pageCache.evictions}</div><div class="metrics-stat-label">Evictions</div></div>
          </div>
        </div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Performance — Dune Admin</title>
  <style>${baseAdminStyles()}
  .metrics-row { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem; }
  .metrics-card { background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:1.25rem; flex:1; min-width:240px; }
  .metrics-card-title { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#6b7280; margin-bottom:0.75rem; }
  .metrics-grid { display:flex; gap:1.25rem; flex-wrap:wrap; }
  .metrics-stat { text-align:center; min-width:60px; }
  .metrics-stat-value { font-size:1.4rem; font-weight:700; color:#111; }
  .metrics-stat-label { font-size:0.72rem; color:#9ca3af; margin-top:0.15rem; }
  .section-title { font-size:0.9rem; font-weight:600; color:#374151; margin:1.25rem 0 0.5rem; }
  .metrics-refresh { font-size:0.78rem; color:#9ca3af; margin-bottom:1rem; }
  </style>
</head>
<body>
  ${adminShell(prefix, "metrics", userName, `
    <h2>Performance</h2>
    <p class="metrics-refresh">Snapshot taken at ${escapeHtml(snap.ts.replace("T", " ").slice(0, 19))} UTC &mdash; auto-refreshes every 30 seconds</p>

    <div class="metrics-row">
      <div class="metrics-card">
        <div class="metrics-card-title">Uptime</div>
        <div class="metrics-stat-value" style="font-size:1.2rem">${Math.floor(snap.uptimeSeconds / 3600)}h ${Math.floor((snap.uptimeSeconds % 3600) / 60)}m ${snap.uptimeSeconds % 60}s</div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-title">Requests</div>
        <div class="metrics-grid">
          <div class="metrics-stat"><div class="metrics-stat-value">${snap.requests.total}</div><div class="metrics-stat-label">Total</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value" style="color:${snap.requests.errors > 0 ? "#dc2626" : "inherit"}">${snap.requests.errors}</div><div class="metrics-stat-label">Errors</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtPct(snap.requests.errorRate)}</div><div class="metrics-stat-label">Error Rate</div></div>
        </div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-title">Latency (all routes)</div>
        <div class="metrics-grid">
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMs(snap.requests.latency.p50)}</div><div class="metrics-stat-label">p50</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMs(snap.requests.latency.p95)}</div><div class="metrics-stat-label">p95</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMs(snap.requests.latency.p99)}</div><div class="metrics-stat-label">p99</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMs(snap.requests.latency.max)}</div><div class="metrics-stat-label">max</div></div>
        </div>
      </div>
    </div>

    <div class="metrics-row">
      <div class="metrics-card">
        <div class="metrics-card-title">Memory</div>
        <div class="metrics-grid">
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMb(snap.memory.heapUsed)}</div><div class="metrics-stat-label">Heap Used</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMb(snap.memory.heapTotal)}</div><div class="metrics-stat-label">Heap Total</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMb(snap.memory.rss)}</div><div class="metrics-stat-label">RSS</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${fmtMb(snap.memory.external)}</div><div class="metrics-stat-label">External</div></div>
        </div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-title">Engine</div>
        <div class="metrics-grid">
          <div class="metrics-stat"><div class="metrics-stat-value">${snap.engine.pageCount}</div><div class="metrics-stat-label">Pages</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${snap.engine.rebuildCount}</div><div class="metrics-stat-label">Rebuilds</div></div>
          <div class="metrics-stat"><div class="metrics-stat-value">${snap.engine.lastRebuildMs !== null ? fmtMs(snap.engine.lastRebuildMs) : "—"}</div><div class="metrics-stat-label">Last Rebuild</div></div>
        </div>
      </div>
      ${pageCacheHtml}
    </div>

    <p class="section-title">Top Routes by Request Count</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Route</th>
          <th>Requests</th>
          <th>Errors</th>
          <th>p50</th>
          <th>p95</th>
          <th>p99</th>
        </tr>
      </thead>
      <tbody>${topRoutesRows}</tbody>
    </table>

    <p class="section-title">Slow Queries (last ${snap.slowQueries.length > 0 ? snap.slowQueries.length : 0})</p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Query</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>${slowRows}</tbody>
    </table>
  `)}
</body>
</html>`;

    return htmlResponse(html);
  }

  // === Workflow handlers ===

  async function handleWorkflowTransition(req: Request, authResult: AuthResult): Promise<Response> {
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
      const userRole = authResult.user?.role;
      if (!workflow.canTransition(currentStatus, newStatus, userRole)) {
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

      // Update published flag based on workflow stage config
      if (workflow.setsPublished(newStatus)) {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: true");
        }
      } else {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: false");
        }
      }

      await storage.write(filePath, new TextEncoder().encode(updated));
      await engine.rebuild();

      // Fire content hooks + outbound webhooks (fire-and-forget)
      const webhookEndpointsWf = config.config.admin?.webhooks ?? [];
      const runtimeDirWf = config.config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) {
        hooks.fire("onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }).catch(() => {});
      }
      fireContentWebhooks(webhookEndpointsWf, "onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }, runtimeDirWf);

      return jsonResponse({ transitioned: true, from: currentStatus, to: newStatus });
    } catch (err) {
      return serverError(err);
    }
  }

  function handleGetWorkflowStatus(pagePath: string, authResult: AuthResult): Response {
    if (!workflow) return jsonResponse({ error: "Workflow not enabled" }, 501);
    const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
    if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

    const status = workflow.getStatus(pageIndex);
    const userRole = authResult.user?.role;
    const transitionObjects = workflow.allowedTransitionObjects(status, userRole);
    const allowedTransitions = transitionObjects.map((t) => t.to);
    const transitions = transitionObjects.map((t) => ({ to: t.to, label: t.label ?? t.to }));

    return jsonResponse({
      sourcePath: pagePath,
      status,
      allowedTransitions,
      transitions,
      stages: workflow.stages,
    });
  }

  function handleGetWorkflowStages(): Response {
    if (!workflow) return jsonResponse({ stages: [], defaultStatus: "draft" });
    return jsonResponse({
      stages: workflow.stages,
      defaultStatus: workflow.stages[0]?.id ?? "draft",
    });
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

  // === Staging handlers ===

  async function handleStagingUpsert(req: Request, pagePath: string, authResult: AuthResult): Promise<Response> {
    if (!staging) return jsonResponse({ error: "Staging not enabled" }, 501);
    try {
      const body = await req.json() as { content?: string; frontmatter?: Record<string, unknown> };
      const { content = "", frontmatter = {} } = body;

      const draft = await staging.upsert({
        sourcePath: pagePath,
        content,
        frontmatter,
        createdBy: authResult.user?.name,
      });

      const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
      return jsonResponse({ ok: true, token: draft.token, previewUrl, updatedAt: draft.updatedAt });
    } catch (err) {
      return serverError(err);
    }
  }

  async function handleStagingGet(pagePath: string): Promise<Response> {
    if (!staging) return jsonResponse({ error: "Staging not enabled" }, 501);
    const draft = await staging.get(pagePath);
    if (!draft) return jsonResponse({ draft: null });
    const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
    return jsonResponse({
      draft: {
        sourcePath: draft.sourcePath,
        token: draft.token,
        updatedAt: draft.updatedAt,
        createdBy: draft.createdBy,
        previewUrl,
      },
    });
  }

  async function handleStagingDiscard(pagePath: string): Promise<Response> {
    if (!staging) return jsonResponse({ error: "Staging not enabled" }, 501);
    await staging.discard(pagePath);
    return jsonResponse({ discarded: true });
  }

  async function handleStagingPublish(pagePath: string, authResult: AuthResult): Promise<Response> {
    if (!staging) return jsonResponse({ error: "Staging not enabled" }, 501);
    try {
      const draft = await staging.get(pagePath);
      if (!draft) return jsonResponse({ error: "No draft found for this page" }, 404);

      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return jsonResponse({ error: "Page not found" }, 404);

      const contentDir = config.config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;

      // Write draft content to the live file (same format as restore)
      const fmYaml = stringifyYaml(draft.frontmatter as Record<string, unknown>).trimEnd();
      const fullContent = `---\n${fmYaml}\n---\n\n${draft.content}`;
      await storage.write(filePath, new TextEncoder().encode(fullContent));

      // Record revision for the publish action
      if (history) {
        await history.record({
          sourcePath: pagePath,
          content: draft.content,
          frontmatter: draft.frontmatter,
          author: authResult.user?.name,
          message: "Published from staging",
        });
      }

      // Git auto-commit if enabled
      await maybeGitCommit(filePath, pagePath, authResult.user?.name);

      // Discard the draft and rebuild
      await staging.discard(pagePath);
      await engine.rebuild();

      return jsonResponse({ published: true, sourcePath: pagePath });
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

  // === Flex Object handlers ===

  /** Helper: wrap content in a full admin HTML page with flex styles. */
  function renderFlexHtmlPage(
    title: string,
    userName: string,
    content: string,
    extraScript = "",
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Dune Admin</title>
  <style>${baseAdminStyles()}${flexStyles()}</style>
</head>
<body>
  ${adminShell(prefix, "flex", userName, content)}
  ${extraScript}
</body>
</html>`;
  }

  async function handleFlexTypeListPage(authResult: AuthResult): Promise<Response> {
    if (!flex) {
      return htmlResponse(renderFlexHtmlPage(
        "Flex Objects",
        authResult.user?.name ?? "Admin",
        `<div class="flex-empty-state"><div class="flex-empty-icon">🗂️</div><h2>Flex Objects not enabled</h2><p>Pass a <code>FlexEngine</code> to <code>createAdminHandler</code> to enable Flex Objects.</p></div>`,
      ));
    }
    const schemas = await flex.loadSchemas();
    const counts: Record<string, number> = {};
    await Promise.all(
      Object.keys(schemas).map(async (type) => {
        const records = await flex.list(type);
        counts[type] = records.length;
      }),
    );
    const userName = authResult.user?.name ?? "Admin";
    const content = renderFlexTypeList(prefix, schemas, counts);
    return htmlResponse(renderFlexHtmlPage("Flex Objects", userName, content));
  }

  async function handleFlexRecordListPage(type: string, authResult: AuthResult): Promise<Response> {
    if (!flex) return htmlResponse("<h1>503</h1>", 503);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) {
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/flex` },
      });
    }
    const records = await flex.list(type);
    const userName = authResult.user?.name ?? "Admin";
    const content = renderFlexRecordList(prefix, type, schema, records);
    return htmlResponse(renderFlexHtmlPage(schema.title, userName, content));
  }

  async function handleFlexEditorPage(
    type: string,
    recordId: string | null,
    authResult: AuthResult,
  ): Promise<Response> {
    if (!flex) return htmlResponse("<h1>503</h1>", 503);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) {
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/flex` },
      });
    }
    const record = recordId ? await flex.get(type, recordId) : null;
    if (recordId && !record) {
      return new Response(null, {
        status: 302,
        headers: { "Location": `${prefix}/flex/${encodeURIComponent(type)}` },
      });
    }
    const userName = authResult.user?.name ?? "Admin";
    const title = `${recordId ? "Edit" : "New"} ${schema.title}`;
    const content = renderFlexEditor(prefix, type, schema, record);
    const script = flexScript(prefix, type, recordId);
    return htmlResponse(renderFlexHtmlPage(title, userName, content, script));
  }

  async function handleFlexApiList(type: string): Promise<Response> {
    if (!flex) return jsonResponse({ error: "Flex Objects not enabled" }, 501);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return jsonResponse({ error: "Unknown type" }, 404);
    const records = await flex.list(type);
    return jsonResponse({ items: records, total: records.length });
  }

  async function handleFlexApiGet(type: string, id: string): Promise<Response> {
    if (!flex) return jsonResponse({ error: "Flex Objects not enabled" }, 501);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return jsonResponse({ error: "Unknown type" }, 404);
    const record = await flex.get(type, id);
    if (!record) return jsonResponse({ error: "Record not found" }, 404);
    return jsonResponse(record);
  }

  async function handleFlexApiCreate(type: string, req: Request): Promise<Response> {
    if (!flex) return jsonResponse({ error: "Flex Objects not enabled" }, 501);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) return jsonResponse({ error: "Unknown type" }, 404);
    try {
      const body = await req.json() as Record<string, unknown>;
      const record = await flex.create(type, schema, body);
      return jsonResponse({ record }, 201);
    } catch (err) {
      if (Array.isArray(err)) {
        return jsonResponse({ error: "Validation failed", validationErrors: err }, 422);
      }
      throw err;
    }
  }

  async function handleFlexApiUpdate(type: string, id: string, req: Request): Promise<Response> {
    if (!flex) return jsonResponse({ error: "Flex Objects not enabled" }, 501);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) return jsonResponse({ error: "Unknown type" }, 404);
    try {
      const body = await req.json() as Record<string, unknown>;
      const record = await flex.update(type, id, schema, body);
      if (!record) return jsonResponse({ error: "Record not found" }, 404);
      return jsonResponse({ record });
    } catch (err) {
      if (Array.isArray(err)) {
        return jsonResponse({ error: "Validation failed", validationErrors: err }, 422);
      }
      throw err;
    }
  }

  async function handleFlexApiDelete(type: string, id: string): Promise<Response> {
    if (!flex) return jsonResponse({ error: "Flex Objects not enabled" }, 501);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return jsonResponse({ error: "Unknown type" }, 404);
    await flex.delete(type, id);
    return jsonResponse({ deleted: true });
  }

  // === Blueprint-driven form handlers (public) ===

  /** GET /api/forms/:name — return the form schema as JSON. */
  async function handleFormSchema(formName: string): Promise<Response> {
    const form = await loadForm(storage, "forms", formName);
    if (!form) {
      return jsonResponse({ error: `Form "${formName}" not found` }, 404);
    }
    // Return the public schema — omit internal server-side config (emails, webhooks)
    return jsonResponse({
      name: formName,
      title: form.title,
      success_url: form.success_url ?? "/",
      fields: form.fields,
      // Expose honeypot field name so the front-end can render the hidden input
      honeypot: form.honeypot ?? config.config.admin?.honeypot ?? "_hp",
    });
  }

  /** POST /api/forms/:name — validate and store a blueprint-driven form submission. */
  async function handleFormSubmission(req: Request, formName: string): Promise<Response> {
    if (!submissions) {
      return jsonResponse({ error: "Submissions not enabled" }, 501);
    }

    const form = await loadForm(storage, "forms", formName);
    if (!form) {
      return jsonResponse({ error: `Form "${formName}" not found` }, 404);
    }

    try {
      // Rate limit by IP
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
        ?? req.headers.get("x-real-ip")
        ?? "unknown";
      if (!contactRateLimiter.check(ip)) {
        const retryAfter = contactRateLimiter.retryAfter(ip);
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
        });
      }

      // Parse body
      const contentType = req.headers.get("content-type") ?? "";
      let fields: Record<string, string> = {};
      const uploadedFiles: Array<{ key: string; file: File }> = [];

      if (contentType.includes("application/json")) {
        const body = await req.json();
        for (const [k, v] of Object.entries(body)) {
          if (typeof v === "string") fields[k] = v;
        }
      } else {
        const formData = await req.formData();
        for (const [k, v] of formData.entries()) {
          if (typeof v === "string") {
            fields[k] = v;
          } else if (v instanceof File && v.size > 0) {
            uploadedFiles.push({ key: k, file: v });
          }
        }
      }

      // Honeypot anti-spam
      const honeypotField = form.honeypot ?? config.config.admin?.honeypot ?? "_hp";
      if (fields[honeypotField]) {
        const acceptsJson = req.headers.get("accept")?.includes("application/json");
        if (acceptsJson) return jsonResponse({ ok: true });
        return new Response(null, { status: 302, headers: { Location: form.success_url ?? "/" } });
      }
      delete fields[honeypotField];

      // Schema validation
      const validationErrors = validateFormSubmission(form, fields);
      if (validationErrors.length > 0) {
        const acceptsJson = req.headers.get("accept")?.includes("application/json");
        if (acceptsJson) {
          return jsonResponse({ error: "Validation failed", errors: validationErrors }, 422);
        }
        // For regular form POST, redirect back with error indicator
        const requestOrigin = new URL(req.url).origin;
        const referer = req.headers.get("referer");
        let redirectPath = "/";
        if (referer) {
          try {
            const u = new URL(referer);
            if (u.origin === requestOrigin) {
              u.searchParams.set("form_error", "1");
              redirectPath = u.pathname + u.search;
            }
          } catch { /* bad referer */ }
        }
        return new Response(null, { status: 302, headers: { Location: redirectPath } });
      }

      // File uploads
      const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
      const storedFiles: SubmissionFile[] = [];
      if (uploadedFiles.length > 0) {
        const dataDir = config.config.admin?.dataDir ?? "data";
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        const MAX_FILES = 5;
        for (const { file } of uploadedFiles.slice(0, MAX_FILES)) {
          if (file.size > MAX_FILE_SIZE) continue;
          const safeName = file.name
            .replace(/[/\\:*?"<>|]/g, "_")
            .replace(/\s+/g, "_")
            .replace(/_{2,}/g, "_")
            .slice(0, 200);
          if (!safeName) continue;
          const storagePath = `${dataDir}/uploads/${formName}/${submissionId}/${safeName}`;
          await storage.write(storagePath, new Uint8Array(await file.arrayBuffer()));
          storedFiles.push({
            name: safeName,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            storagePath,
          });
        }
      }

      const submission = await submissions.create(formName, fields, {
        ip: ip === "unknown" ? undefined : ip,
        language: req.headers.get("accept-language") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }, { id: submissionId, files: storedFiles });

      // Notifications — use global SMTP/webhook config as the base; per-form
      // overrides only replace the destination (to address / webhook URL).
      const globalNotif = config.config.admin?.notifications;
      if (globalNotif?.email) {
        // Per-form email override replaces the `to` address; SMTP credentials stay global.
        const emailCfg = form.notifications?.email
          ? { ...globalNotif.email, to: form.notifications.email }
          : globalNotif.email;
        sendSubmissionEmail(emailCfg, submission)
          .catch((err: Error) => console.error(`[dune] Email notification failed: ${err.message}`));
      }
      if (globalNotif?.webhook || form.notifications?.webhook) {
        // Per-form webhook override replaces the URL; keep global secret/headers if any.
        const webhookCfg = form.notifications?.webhook
          ? { ...(globalNotif?.webhook ?? {}), url: form.notifications.webhook } as import("../config/types.ts").WebhookNotificationConfig
          : globalNotif!.webhook!;
        sendWebhookNotification(webhookCfg, submission)
          .catch((err: Error) => console.error(`[dune] Webhook notification failed: ${err.message}`));
      }

      const acceptsJson = req.headers.get("accept")?.includes("application/json");
      if (acceptsJson) return jsonResponse({ ok: true });

      const successUrl = form.success_url ?? "/";
      return new Response(null, { status: 302, headers: { Location: successUrl } });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Contact form submission handler (public) ===

  // ─── Incoming webhook handler ────────────────────────────────────────────
  // POST /api/webhook/incoming
  // Body: { token: string } — optional, token may also be in Authorization header
  //   Bearer <token>  OR  body.token
  // Matches token against config.admin.incoming_webhooks entries.
  // Token values starting with "$" are expanded from environment variables.
  // On match, dispatches the permitted actions requested in the body.
  async function handleIncomingWebhook(req: Request): Promise<Response> {
    const incomingWebhooks = config.config.admin?.incoming_webhooks;
    if (!incomingWebhooks || incomingWebhooks.length === 0) {
      return jsonResponse({ error: "Incoming webhooks not configured" }, 501);
    }

    // Extract token from Authorization header (Bearer) or JSON body
    let token: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // body optional — token may be in header only
    }

    if (!token && typeof body.token === "string") {
      token = body.token;
    }

    if (!token) {
      return jsonResponse({ error: "Missing token" }, 401);
    }

    // Find a matching webhook config entry (expand $ENV_VAR tokens)
    const expandToken = (t: string): string => {
      if (t.startsWith("$")) {
        return Deno.env.get(t.slice(1)) ?? t;
      }
      return t;
    };

    const matched = incomingWebhooks.find(
      (wh) => expandToken(wh.token) === token,
    );

    if (!matched) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Determine which actions to run — request body may specify a subset
    let requestedActions: string[];
    if (Array.isArray(body.actions)) {
      requestedActions = body.actions.filter(
        (a) => typeof a === "string" && matched.actions.includes(a as "rebuild" | "purge-cache"),
      );
    } else {
      // No specific action requested — run all permitted actions
      requestedActions = matched.actions as string[];
    }

    if (requestedActions.length === 0) {
      return jsonResponse({ error: "No permitted actions match the request" }, 400);
    }

    const executed: string[] = [];

    for (const action of requestedActions) {
      if (action === "rebuild") {
        // Fire-and-forget — don't block the response
        engine.rebuild().catch((err: unknown) => {
          console.error("[dune] incoming webhook rebuild error:", err);
        });
        void auditLogger?.log({
          event: "system.rebuild",
          actor: null,
          ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null,
          userAgent: req.headers.get("user-agent"),
          target: { type: "system" },
          detail: {},
          outcome: "success",
        }).catch(() => {});
        executed.push("rebuild");
      } else if (action === "purge-cache") {
        if (imageCache) {
          await imageCache.clear();
        }
        void auditLogger?.log({
          event: "system.cache_purge",
          actor: null,
          ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null,
          userAgent: req.headers.get("user-agent"),
          target: { type: "system" },
          detail: {},
          outcome: "success",
        }).catch(() => {});
        executed.push("purge-cache");
      }
    }

    return jsonResponse({ ok: true, executed });
  }

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
      const uploadedFiles: Array<{ key: string; file: File }> = [];

      if (contentType.includes("application/json")) {
        const body = await req.json();
        for (const [k, v] of Object.entries(body)) {
          if (typeof v === "string") fields[k] = v;
        }
      } else {
        // application/x-www-form-urlencoded or multipart/form-data
        const formData = await req.formData();
        for (const [k, v] of formData.entries()) {
          if (typeof v === "string") {
            fields[k] = v;
          } else if (v instanceof File && v.size > 0) {
            uploadedFiles.push({ key: k, file: v });
          }
        }
      }

      // ── Honeypot anti-spam ────────────────────────────────────────────────
      // If the configured honeypot field is present and non-empty, a bot filled
      // it in. Silently accept (so bots get no useful signal) but don't save.
      const honeypotField = config.config.admin?.honeypot ?? "_hp";
      if (fields[honeypotField]) {
        // Looks like a bot submission — return success without saving
        const acceptsJson = req.headers.get("accept")?.includes("application/json");
        if (acceptsJson) return jsonResponse({ ok: true });
        return new Response(null, { status: 302, headers: { "Location": "/" } });
      }
      delete fields[honeypotField]; // remove the empty honeypot field from data

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

      // ── File uploads ──────────────────────────────────────────────────────
      // Pre-generate submission ID so we can store files before creating the record.
      const submissionId = encodeHex(crypto.getRandomValues(new Uint8Array(6)));
      const storedFiles: SubmissionFile[] = [];

      if (uploadedFiles.length > 0) {
        const dataDir = config.config.admin?.dataDir ?? "data";
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
        const MAX_FILES = 5;

        for (const { key: _key, file } of uploadedFiles.slice(0, MAX_FILES)) {
          if (file.size > MAX_FILE_SIZE) continue; // silently skip oversized files

          // Sanitise filename: strip path separators, collapse whitespace
          const safeName = file.name
            .replace(/[/\\:*?"<>|]/g, "_")
            .replace(/\s+/g, "_")
            .replace(/_{2,}/g, "_")
            .slice(0, 200);
          if (!safeName) continue;

          const storagePath = `${dataDir}/uploads/${formName}/${submissionId}/${safeName}`;
          const bytes = new Uint8Array(await file.arrayBuffer());
          await storage.write(storagePath, bytes);

          storedFiles.push({
            name: safeName,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            storagePath,
          });
        }
      }

      const submission = await submissions.create(formName, fields, {
        ip: ip === "unknown" ? undefined : ip,
        language,
        userAgent,
      }, { id: submissionId, files: storedFiles });

      // ── Notifications (fire-and-forget) ───────────────────────────────────
      const notifCfg = config.config.admin?.notifications;
      if (notifCfg) {
        if (notifCfg.email) {
          sendSubmissionEmail(notifCfg.email, submission)
            .catch((err: Error) => console.error(`[dune] Email notification failed: ${err.message}`));
        }
        if (notifCfg.webhook) {
          sendWebhookNotification(notifCfg.webhook, submission)
            .catch((err: Error) => console.error(`[dune] Webhook notification failed: ${err.message}`));
        }
      }

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

  async function handleSubmissionFileDownload(form: string, id: string, filename: string): Promise<Response> {
    const dataDir = config.config.admin?.dataDir ?? "data";
    const storagePath = `${dataDir}/uploads/${form}/${id}/${filename}`;
    try {
      const data = await storage.read(storagePath);
      // Look up content-type from submission metadata
      const sub = await submissions?.get(form, id);
      const fileMeta = sub?.files?.find((f) => f.name === filename);
      const contentType = fileMeta?.contentType ?? "application/octet-stream";
      return new Response(data.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
          "Content-Length": String(data.byteLength),
          "Cache-Control": "private, no-store",
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
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

    const content = renderTranslationStatus(pfx, { languages, defaultLanguage: defaultLang, pages, mtEnabled: mt != null });

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
    <div class="i18n-page-header">
      <h2>Translations</h2>
      <a href="${pfx}/i18n/memory" class="btn btn-sm btn-outline">🧠 Translation Memory</a>
    </div>
    ${content}
  `)}
</body>
</html>`;
  }

  // === Config editor ===

  async function renderConfigPage(pfx: string, authResult: AuthResult): Promise<string> {
    const userName = authResult.user?.name ?? "Admin";

    // Build theme data for the Theme tab (best-effort — failures return empty data)
    let themeData: ConfigEditorThemeData | undefined;
    try {
      const availableThemes = await engine.getAvailableThemes();
      const manifest = engine.themes.theme.manifest;
      themeData = {
        availableThemes,
        currentTheme: engine.config.theme.name,
        themeSchema: (manifest.configSchema ?? {}) as Record<string, import("../blueprints/types.ts").BlueprintField>,
        themeConfig: engine.themeConfig,
        navRoutes: engine.router.getTopNavigation("en")
          .map((p) => ({ route: p.route, title: p.navTitle || p.title || p.route })),
      };
    } catch {
      // Theme data unavailable — omit the Theme tab content
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configuration — Dune Admin</title>
  <style>${baseAdminStyles()}${configEditorStyles()}</style>
</head>
<body>
  ${adminShell(pfx, "config", userName, renderConfigEditor(pfx, config.config, themeData))}
</body>
</html>`;
  }

  async function handleConfigSave(req: Request): Promise<Response> {
    try {
      const body = await req.json() as {
        site?: Record<string, unknown>;
        system?: Record<string, unknown>;
      };

      const { site: siteData, system: systemData } = body;

      // Read existing YAML files so we preserve keys the editor doesn't manage
      // (theme, metadata, routes, redirects, plugins, etc.)
      const [existingSiteRaw, existingSystemRaw] = await Promise.all([
        storage.readText("config/site.yaml").catch(() => ""),
        storage.readText("config/system.yaml").catch(() => ""),
      ]);

      const existingSite = (parseYaml(existingSiteRaw || "") ?? {}) as Record<string, unknown>;
      const existingSystem = (parseYaml(existingSystemRaw || "") ?? {}) as Record<
        string,
        unknown
      >;

      // Merge: existing → new (editor values win; unmanaged keys preserved)
      const mergedSite = siteData ? { ...existingSite, ...siteData } : existingSite;
      const mergedSystem = systemData
        ? deepMergeConfig(existingSystem, systemData)
        : existingSystem;

      // Validate the resulting full config (using current defaults as base)
      const testConfig = {
        site: { ...config.config.site, ...mergedSite } as typeof config.config.site,
        system: deepMergeConfig(
          config.config.system as unknown as Record<string, unknown>,
          mergedSystem,
        ) as unknown as typeof config.config.system,
        theme: config.config.theme,
        plugins: config.config.plugins,
        pluginList: config.config.pluginList,
        admin: config.config.admin,
      };

      const errors = validateConfig(testConfig);
      if (errors.length > 0) {
        return jsonResponse({ error: "Validation failed", validationErrors: errors }, 422);
      }

      // Write back to YAML files
      await Promise.all([
        storage.write("config/site.yaml", stringifyYaml(mergedSite).trimEnd() + "\n"),
        storage.write("config/system.yaml", stringifyYaml(mergedSystem).trimEnd() + "\n"),
      ]);

      return jsonResponse({ updated: true, restartRequired: true });
    } catch (err) {
      return serverError(err);
    }
  }

  // === Theme marketplace page ===

  async function renderThemesPageHtml(pfx: string, authResult: AuthResult): Promise<string> {
    // Load installed themes with their manifests
    const installedNames = await engine.getAvailableThemes();
    const installed: InstalledThemeInfo[] = await Promise.all(
      installedNames.map(async (slug) => {
        try {
          const loader = await engine.createPreviewTheme(slug);
          return { slug, manifest: loader.theme.manifest };
        } catch {
          return { slug, manifest: { name: slug } };
        }
      }),
    );

    // Load the bundled registry (best-effort; fallback to empty if missing)
    let registry: ThemeRegistry = { version: 1, themes: [] };
    try {
      const registryUrl = new URL("./registry/themes.json", import.meta.url);
      const registryText = await Deno.readTextFile(registryUrl);
      registry = JSON.parse(registryText) as ThemeRegistry;
    } catch { /* leave empty */ }

    return renderThemesPage(pfx, installed, engine.config.theme.name, registry, authResult);
  }

  // === Theme preview handler ===

  async function handleThemePreview(url: URL): Promise<Response> {
    const themeName = url.searchParams.get("theme") ?? "";
    const route = url.searchParams.get("route") || "/";

    // Validate the requested theme
    const available = await engine.getAvailableThemes();
    if (!available.includes(themeName)) {
      return htmlResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Theme Not Found</title></head>
<body style="font-family:system-ui;padding:2rem;color:#555">
  <p>⚠ Theme <code>${escapeHtml(themeName)}</code> not found. Available: ${available.map(escapeHtml).join(", ") || "none"}.</p>
</body></html>`,
        404,
      );
    }

    // Find the page by route
    const pageIndex = engine.pages.find((p) => p.route === route && p.published && p.routable);
    if (!pageIndex) {
      return htmlResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Route Not Found</title></head>
<body style="font-family:system-ui;padding:2rem;color:#555">
  <p>⚠ No published page at route <code>${escapeHtml(route)}</code>.</p>
</body></html>`,
        404,
      );
    }

    try {
      // TSX pages render themselves — we can't easily swap their layout from here.
      // Show a helpful note rather than silently rendering with the wrong theme.
      if (pageIndex.format === "tsx") {
        return htmlResponse(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TSX Page Preview</title></head>
<body style="font-family:system-ui;padding:2rem;color:#555;max-width:600px;margin:2rem auto">
  <p>ℹ TSX pages are self-rendering and cannot be previewed with a different theme in this panel.</p>
  <p>Switch the active theme to see TSX pages with the new theme.</p>
</body></html>`,
        );
      }

      // Load the page and create a temporary preview theme loader
      const [page, previewLoader] = await Promise.all([
        engine.loadPage(pageIndex.sourcePath),
        engine.createPreviewTheme(themeName),
      ]);

      // Render HTML content from the page
      const html = await page.html();

      // Try to load the appropriate template from the preview theme
      const templateName = previewLoader.resolveTemplateName(page) ?? "default";
      const template = await previewLoader.loadTemplate(templateName);

      if (!template) {
        // Fallback: minimal shell without theme styles
        const pageTitle = buildPageTitle(page, engine.site.title);
        return htmlResponse(`<!DOCTYPE html><html><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}img{max-width:100%}</style>
</head><body>
  <h1>${escapeHtml(page.frontmatter.title ?? "")}</h1>
  <div>${html}</div>
</body></html>`);
      }

      // Full render through the preview theme template + layout
      const layout = await previewLoader.loadLayout("layout");
      const strings = await previewLoader.loadLocale(pageIndex.language ?? "en");
      const t = (key: string) => (strings[key] ?? key) as string;

      const rendered = renderJsxToString(
        h((template.component as unknown) as ComponentType<Record<string, unknown>>, {
          page,
          pageTitle: buildPageTitle(page, engine.site.title),
          site: engine.site,
          config: engine.config,
          nav: engine.router.getTopNavigation(pageIndex.language),
          pathname: route,
          search: "",
          Layout: layout ?? undefined,
          themeConfig: engine.themeConfig,
          t,
          children: h("div", { dangerouslySetInnerHTML: { __html: html } }),
        }),
      );

      return htmlResponse(`<!DOCTYPE html>${rendered}`);
    } catch (err) {
      return serverErrorHtml(err, "theme-preview");
    }
  }

  // === Theme registry handler ===

  async function handleThemeRegistry(): Promise<Response> {
    try {
      const registryUrl = new URL("./registry/themes.json", import.meta.url);
      const registryText = await Deno.readTextFile(registryUrl);
      const registry = JSON.parse(registryText) as ThemeRegistry;
      return jsonResponse(registry);
    } catch {
      return jsonResponse({ version: 1, themes: [] });
    }
  }

  // === Theme install handler ===

  async function handleThemeInstall(req: Request): Promise<Response> {
    try {
      const { slug, downloadUrl } = await req.json() as { slug?: string; downloadUrl?: string };

      if (!slug || typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
        return jsonResponse({ error: "Invalid slug — must match [a-z0-9][a-z0-9_-]*" }, 400);
      }
      if (!downloadUrl || typeof downloadUrl !== "string") {
        return jsonResponse({ error: "downloadUrl required" }, 400);
      }

      // Only allow https:// to prevent SSRF against local services
      if (!downloadUrl.startsWith("https://")) {
        return jsonResponse({ error: "downloadUrl must be an https:// URL" }, 400);
      }

      // Fetch the ZIP
      const fetchResp = await fetch(downloadUrl, {
        headers: { "User-Agent": "Dune-CMS/0.3 theme-installer" },
      });
      if (!fetchResp.ok) {
        return jsonResponse(
          { error: `Failed to fetch theme ZIP: HTTP ${fetchResp.status}` },
          502,
        );
      }

      const zipBytes = new Uint8Array(await fetchResp.arrayBuffer());

      // Extract using @zip-js/zip-js
      const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip-js/zip-js");
      const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
      const entries = await zipReader.getEntries();

      const themesDir = engine.config.system?.content?.dir
        ? "themes"
        : "themes"; // always "themes/"
      const destPrefix = `${themesDir}/${slug}/`;

      let filesWritten = 0;
      for (const entry of entries) {
        if (entry.directory) continue;

        // Strip any leading path component (e.g. "theme-name/templates/..." → "templates/...")
        let filename = entry.filename.replace(/^[^/]+\//, "");

        // Security: reject path traversal
        if (filename.includes("..") || filename.startsWith("/")) continue;

        const data = await entry.getData!(new Uint8ArrayWriter());
        await storage.write(`${destPrefix}${filename}`, data);
        filesWritten++;
      }

      await zipReader.close();

      console.log(`  📦 Installed theme "${slug}" (${filesWritten} files) from ${downloadUrl}`);
      return jsonResponse({ success: true, slug, filesWritten });
    } catch (err) {
      return serverError(err, "theme-install");
    }
  }

  /**
   * Save plugin-specific config to data/plugins/{name}.json.
   * The saved values are merged over site.yaml static config at next startup.
   *
   * Performs type coercion (number, toggle) and required-field validation
   * based on the plugin's configSchema before persisting.
   */
  async function handleSavePluginConfig(
    req: Request,
    pluginName: string,
    configSchema: import("../blueprints/types.ts").BlueprintField[] | Record<string, import("../blueprints/types.ts").BlueprintField> | undefined,
  ): Promise<Response> {
    try {
      const body = await req.json() as Record<string, unknown>;

      // Validate and coerce values against schema if present
      if (configSchema && typeof configSchema === "object" && !Array.isArray(configSchema)) {
        const schema = configSchema as Record<string, import("../blueprints/types.ts").BlueprintField>;
        const errors: string[] = [];

        for (const [key, field] of Object.entries(schema)) {
          const val = body[key];

          // Type coercion: convert wire values to their proper types
          if (field.type === "number" && val !== undefined && val !== null) {
            const n = Number(val);
            body[key] = isNaN(n) ? val : n;
          } else if (field.type === "toggle") {
            body[key] = val === true || val === "true";
          }

          // Required check (after coercion)
          const coerced = body[key];
          if (
            field.required &&
            (coerced === undefined || coerced === null || coerced === "")
          ) {
            errors.push(field.label ?? key);
          }
        }

        if (errors.length > 0) {
          return jsonResponse({
            error: `Missing required fields: ${errors.join(", ")}`,
          }, 422);
        }
      }

      const dataDir = config.config.admin?.dataDir ?? "data";
      const pluginsDir = `${dataDir}/plugins`;
      const filePath = `${pluginsDir}/${pluginName}.json`;

      // Persist to data/plugins/{name}.json
      await storage.write(filePath, new TextEncoder().encode(JSON.stringify(body, null, 2)));

      // Update in-memory config so subsequent requests see the new values
      config.config.plugins[pluginName] = {
        ...(config.config.plugins[pluginName] ?? {}),
        ...body,
      };

      return jsonResponse({ saved: true });
    } catch (err) {
      return serverError(err);
    }
  }

  /** Shallow-deep merge for nested system config objects (arrays replaced). */
  function deepMergeConfig(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      const bv = base[key];
      const ov = override[key];
      if (
        ov !== null && typeof ov === "object" && !Array.isArray(ov) &&
        bv !== null && typeof bv === "object" && !Array.isArray(bv)
      ) {
        result[key] = deepMergeConfig(
          bv as Record<string, unknown>,
          ov as Record<string, unknown>,
        );
      } else {
        result[key] = ov;
      }
    }
    return result;
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
    { id: "flex", label: "Flex Objects", icon: "🗃️", href: `${prefix}/flex` },
    { id: "submissions", label: "Submissions", icon: "📬", href: `${prefix}/submissions` },
    { id: "users", label: "Users", icon: "👥", href: `${prefix}/users` },
    { id: "themes", label: "Themes", icon: "🎨", href: `${prefix}/themes` },
    { id: "config", label: "Configuration", icon: "⚙️", href: `${prefix}/config` },
    { id: "audit", label: "Audit Log", icon: "🔒", href: `${prefix}/audit` },
    { id: "metrics", label: "Performance", icon: "📈", href: `${prefix}/metrics` },
  ];

  return `
  <div class="admin-layout">
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

function _htmlResponseBase(
  html: string,
  status = 200,
  siteLang?: string,
  rtlOverride?: string[],
): Response {
  const finalHtml = siteLang
    ? applyAdminRtl(html, siteLang, rtlOverride)
    : html;
  return new Response(finalHtml, {
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
  return _htmlResponseBase("<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>", 500);
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
  .tree-search-form { display: flex; gap: 0.4rem; align-items: center; flex: 1; }
  .tree-search-form input { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; }
  .search-summary { margin-bottom: 0.75rem; font-size: 0.9rem; color: #555; }
  .search-empty { text-align: center; color: #888; padding: 2rem 1rem !important; }
  .table-actions { white-space: nowrap; }
  .pagination { display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; }
  .page-numbers { display: flex; align-items: center; gap: 0.25rem; }
  .page-link { padding: 0.25rem 0.6rem; border-radius: 4px; border: 1px solid #ddd; font-size: 0.85rem; text-decoration: none; color: #333; }
  .page-link:hover { background: #f0f0f0; }
  .page-current { padding: 0.25rem 0.6rem; border-radius: 4px; background: #c9a96e; color: #fff; font-size: 0.85rem; font-weight: 600; }
  .page-ellipsis { padding: 0 0.25rem; color: #aaa; }
  .btn.disabled { opacity: 0.4; cursor: default; pointer-events: none; }
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
  .tree-drag-handle { cursor: grab; color: #ccc; font-size: 0.9rem; padding: 0 0.3rem 0 0; user-select: none; }
  .tree-drag-handle:hover { color: #999; }
  .tree-node.tree-dragging > .tree-row { opacity: 0.4; }
  .tree-row.drop-before { border-top: 2px solid #c9a96e; }
  .tree-row.drop-after { border-bottom: 2px solid #c9a96e; }
  .modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .modal-content { position: relative; background: #fff; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-content h3 { margin-bottom: 1rem; }
  .modal-wide { max-width: 640px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .form-actions .btn-outline { color: #666; border-color: #ddd; }
  small { display: block; margin-top: 0.15rem; color: #999; font-size: 0.75rem; }
  .page-type-toggle { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .page-type-btn { flex: 1; padding: 0.5rem; border: 2px solid #e0e0e0; background: #fafafa; border-radius: 6px; cursor: pointer; font-size: 0.85rem; color: #555; transition: all 0.15s; }
  .page-type-btn.active { border-color: #c9a96e; background: #fdf8f0; color: #92400e; font-weight: 600; }
  .upload-drop-zone { border: 2px dashed #ddd; border-radius: 6px; padding: 1.5rem; text-align: center; background: #fafafa; }
  .upload-drop-zone p { margin: 0.25rem 0; color: #666; font-size: 0.85rem; }
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
  .focal-picker-wrap { position:relative; cursor:crosshair; user-select:none; }
  .focal-picker-wrap img { width:100%; display:block; }
  .focal-dot { position:absolute; width:20px; height:20px; border-radius:50%; background:rgba(201,169,110,0.9); border:2px solid #fff; transform:translate(-50%,-50%); pointer-events:none; box-shadow:0 0 0 1px rgba(0,0,0,0.4); }
  .focal-coords { font-size:0.8rem; color:#666; margin:0.25rem 0 0.5rem; }
  .focal-previews { display:flex; gap:0.75rem; margin-bottom:0.75rem; }
  .focal-preview { overflow:hidden; border-radius:4px; border:1px solid #ddd; }
  .focal-preview img { width:100%; height:100%; object-fit:cover; display:block; }
  .focal-preview-label { font-size:0.7rem; color:#888; text-align:center; margin-top:0.2rem; }
  .modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .modal-content { position: relative; background: #fff; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 640px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-wide { max-width: 640px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  .form-actions .btn-outline { color: #666; border-color: #ddd; }
  .btn-danger { background: #dc2626; color: #fff; border: none; }
  .btn-danger:hover { background: #b91c1c; }
  .media-kind-badge { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.1rem 0.3rem; border-radius: 3px; font-weight: 600; }
  .media-kind-embed { background: #dbeafe; color: #1d4ed8; }
  .media-kind-link { background: #fef3c7; color: #92400e; }
  .upload-drop-zone { border: 2px dashed #ddd; border-radius: 6px; padding: 2rem; text-align: center; background: #fafafa; }
  .upload-drop-zone p { margin: 0.25rem 0; color: #666; font-size: 0.9rem; }
  .upload-drop-zone.drag-over { border-color: #c9a96e; background: #fdf8f0; }
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
      width: 240px;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      z-index: 100;
    }
    .admin-sidebar.open { transform: translateX(0); }
    .admin-main { width: 100%; }
    .admin-content { padding: 1rem; }
    .admin-topbar { padding: 0.6rem 1rem; }
    .tree-actions { opacity: 1 !important; }
    .admin-table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  }
  `;
}
