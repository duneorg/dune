/** POST /admin/submissions/:form/:id/delete */


import type { AdminState } from "../../../../types.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const { submissions, prefix } = getAdminContext();
    const { form, id } = ctx.params;
    if (!submissions) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/submissions` } });
    }
    try {
      await submissions.delete(form, id);
      return new Response(null, {
        status: 302,
        headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}` },
      });
    } catch {
      return new Response(null, {
        status: 302,
        headers: { Location: `${prefix}/submissions/${encodeURIComponent(form)}` },
      });
    }
  },
};
