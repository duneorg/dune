/** POST /admin/submissions/:form/:id/status */

import type { AdminState } from "../../../../types.ts";
import type { SubmissionStatus } from "../../../../submissions.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const { submissions, prefix } = ctx.state.adminContext;
    const { form, id } = ctx.params;
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
