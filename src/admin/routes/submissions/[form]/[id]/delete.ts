/** POST /admin/submissions/:form/:id/delete */

import type { AdminState } from "../../../../types.ts";
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
    const denied = requirePermission(ctx, "submissions.delete");
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
      await submissions.delete(form, id);
    } catch { /* fall through to redirect */ }
    return new Response(null, {
      status: 302,
      headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}` },
    });
  },
};
