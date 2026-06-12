/**
 * Inline editing content API (v0.16+).
 *
 * GET  /admin/api/content/:encodedSourcePath/source
 *   Return the raw Markdown source of the content file (body only, no
 *   frontmatter).  Used by the auto-overlay textarea editor to pre-populate
 *   the edit area with the current content.
 *   Response: `{ body: "# Heading\n..." }`
 *
 * POST /admin/api/content/:encodedSourcePath/commit
 *   Flush the live editing state to a history revision and write committed
 *   Markdown back to the `.md` file.  This is the "Save" action.
 *
 * PATCH /admin/api/content/:encodedSourcePath/fields
 *   Update individual frontmatter fields without touching the Markdown body.
 *   Body: `{ fields: { title: "New title", date: "2026-06-08", ... } }`
 *   Special key `__body` replaces the Markdown body (used by auto-overlay).
 *
 * In all routes `:encodedSourcePath` is the URL-encoded page source path,
 * e.g. `pages%2Fabout%2Fdefault.md`.
 */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck, validatePagePath } from "../_utils.ts";
import { splitFile } from "../../../../collab/manager.ts";
import type { FreshContext } from "fresh";

export const handler = {
  // ── GET /admin/api/content/:path/source ─────────────────────────────────────
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const rest = ctx.params.rest;
    const parts = rest.split("/");

    if (parts.length !== 2 || parts[1] !== "source") {
      return json({ error: "Invalid route" }, 400);
    }

    const sourcePath = decodeURIComponent(parts[0]);
    if (!validatePagePath(sourcePath)) return json({ error: "Invalid path" }, 400);

    const { storage, config } = ctx.state.adminContext;
    const contentDir = config.system.content.dir;
    const filePath = `${contentDir}/${sourcePath}`;

    try {
      const raw = await storage.readText(filePath);
      const { body } = splitFile(raw);
      return json({ body });
    } catch (err) {
      return serverError(err);
    }
  },

  // ── POST /admin/api/content/:path/commit ────────────────────────────────────
  async POST(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const csrfErr = await csrfCheck(ctx);
    if (csrfErr) return csrfErr;

    const { inlineEdit } = ctx.state.adminContext;
    if (!inlineEdit) return json({ error: "Inline editing not enabled" }, 501);

    // rest = "encodedPath/commit" or "encodedPath/fields"
    const rest = ctx.params.rest;
    const parts = rest.split("/");

    if (parts.length !== 2) {
      return json({ error: "Invalid route" }, 400);
    }

    const sourcePath = decodeURIComponent(parts[0]);
    if (!validatePagePath(sourcePath)) return json({ error: "Invalid path" }, 400);

    const action = parts[1];
    if (action !== "commit") {
      return json({ error: "Use PATCH for field updates" }, 405);
    }

    const authResult = ctx.state.auth;
    const author = authResult?.user?.username ?? "unknown";

    try {
      await inlineEdit.commit(sourcePath, author);
      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },

  // ── PATCH /admin/api/content/:path/fields ───────────────────────────────────
  async PATCH(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const csrfErr = await csrfCheck(ctx);
    if (csrfErr) return csrfErr;

    const { inlineEdit } = ctx.state.adminContext;
    if (!inlineEdit) return json({ error: "Inline editing not enabled" }, 501);

    const rest = ctx.params.rest;
    const parts = rest.split("/");

    if (parts.length !== 2) {
      return json({ error: "Invalid route" }, 400);
    }

    const sourcePath = decodeURIComponent(parts[0]);
    if (!validatePagePath(sourcePath)) return json({ error: "Invalid path" }, 400);

    const action = parts[1];
    if (action !== "fields") {
      return json({ error: "Use POST for commit" }, 405);
    }

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      !("fields" in body) ||
      typeof (body as { fields: unknown }).fields !== "object"
    ) {
      return json({ error: "Body must be { fields: { ... } }" }, 400);
    }

    const fields = (body as { fields: Record<string, unknown> }).fields;

    const authResult = ctx.state.auth;
    const author = authResult?.user?.username ?? "unknown";

    try {
      await inlineEdit.patchFields(sourcePath, fields, author);
      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
