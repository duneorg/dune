/** @jsxImportSource preact */
/** GET /admin/pages/builder?path=... — visual page builder */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import PageBuilder from "../../islands/PageBuilder.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { prefix } = ctx.state.adminContext;
    const pagePath = ctx.url.searchParams.get("path");
    if (!pagePath) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/pages` } });
    }
    return ctx.render(<PageBuilderRoute data={{ pagePath, prefix }} />);
  },
};

export default function PageBuilderRoute(
  { data }: { data: { pagePath: string; prefix: string } },
) {
  return (
    <div style="height:calc(100vh - 104px)">
      <PageBuilder pagePath={data.pagePath} prefix={data.prefix} />
    </div>
  );
}
