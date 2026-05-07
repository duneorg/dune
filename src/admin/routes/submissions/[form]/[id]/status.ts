/** POST /admin/submissions/:form/:id/status */

import type { AdminState } from "../../../../types.ts";
import type { SubmissionStatus } from "../../../../submissions.ts";
import { csrfCheck, requirePermission } from "../../../api/_utils.ts";
import type { FreshContext } from "fresh";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,128}$/;
function safeSegment(s: string): boolean {
  if (!s || s === "." || s === "..") return false;
  if (s.includes("\0") || s.includes("/") || s.includes("\\")) return false;
  return SAFE_SEGMENT_RE.test(s);
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    // Status update (mark as read / archive) is editorial workflow —
    // align with the read permission rather than requiring delete.
    const denied = requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, prefix } = ctx.state.adminContext;
    const form = decodeURIComponent(ctx.params.form);
    const id = decodeURIComponent(ctx.params.id);
    if (!safeSegment(form) || !safeSegment(id)) {
      return new Response(null, { status: 400 });
    }
    if (!submissions) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/submissions` } });
    }
    try {
      const formData = await ctx.req.formData();
      const status = formData.get("status") as string;
      if (!["new", "read", "archived"].includes(status)) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}/${id}` },
        });
      }
      await submissions.setStatus(form, id, status as SubmissionStatus);
      return new Response(null, {
        status: 302,
        headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}/${id}` },
      });
    } catch {
      return new Response(null, {
        status: 302,
        headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}` },
      });
    }
  },
};
