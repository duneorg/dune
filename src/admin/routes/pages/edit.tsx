/** @jsxImportSource preact */
/** GET /admin/pages/edit?path=... — page editor */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import PageEditor from "../../islands/PageEditor.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { engine, prefix } = ctx.state.adminContext;
    const pagePath = ctx.url.searchParams.get("path");
    if (!pagePath) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/pages` } });
    }
    const pageIndex = engine.pages.find((p) => p.route === pagePath);
    return ctx.render(<PageEditorRoute data={{ pagePath, pageIndex, prefix }} />);
  },
};

export default function PageEditorRoute(
  { data }: { data: { pagePath: string; pageIndex: unknown; prefix: string } },
) {
  return (
    <div style="height:calc(100vh - 104px)">
      <PageEditor
        pagePath={data.pagePath}
        pageIndex={data.pageIndex}
        prefix={data.prefix}
      />
    </div>
  );
}
