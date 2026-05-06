/** @jsxImportSource preact */
/** GET /admin/pages/history?path=... — revision history */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import RevisionHistory from "../../islands/RevisionHistory.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { prefix } = getAdminContext();
    const pagePath = ctx.url.searchParams.get("path");
    if (!pagePath) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/pages` } });
    }
    return ctx.render(<PageHistoryRoute data={{ pagePath, prefix }} />);
  },
};

export default function PageHistoryRoute(
  { data }: { data: { pagePath: string; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Revision History</h2>
        <a href={`${data.prefix}/pages/edit?path=${encodeURIComponent(data.pagePath)}`} class="btn">Back to editor</a>
      </div>
      <RevisionHistory pagePath={data.pagePath} prefix={data.prefix} />
    </div>
  );
}
