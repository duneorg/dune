/** GET /admin/submissions/:form/:id/files/:filename */

import type { AdminState } from "../../../../../types.ts";
import type { FreshContext } from "fresh";
import { requirePermission } from "../../../../api/_utils.ts";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function safeSegment(s: string): boolean {
  if (!s || s === "." || s === "..") return false;
  if (s.includes("\0") || s.includes("/") || s.includes("\\")) return false;
  return SAFE_SEGMENT_RE.test(s);
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, storage } = ctx.state.adminContext;
    if (!submissions) {
      return new Response("Submissions not enabled", { status: 501 });
    }

    const form = decodeURIComponent(ctx.params.form);
    const id = decodeURIComponent(ctx.params.id);
    const filename = decodeURIComponent(ctx.params.filename);

    if (!safeSegment(form) || !safeSegment(id) || !safeSegment(filename)) {
      return new Response("Invalid path", { status: 400 });
    }

    const sub = await submissions.get(form, id);
    if (!sub) {
      return new Response("Not found", { status: 404 });
    }

    const fileMeta = sub.files?.find((f) => f.name === filename);
    if (!fileMeta) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const data = await storage.read(fileMeta.storagePath);
      const contentType = fileMeta.contentType ?? "application/octet-stream";
      const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      return new Response(data.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "Content-Length": String(data.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
    }
  },
};
