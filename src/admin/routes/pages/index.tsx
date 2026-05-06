/** @jsxImportSource preact */
/** GET /admin/pages — page tree with search */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import PageTree from "../../islands/PageTree.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    if (!ctx.state.auth.authenticated) {
      return new Response(null, { status: 302, headers: { Location: `${ctx.state.adminContext.prefix}/login` } });
    }
    const { engine, prefix } = ctx.state.adminContext;
    const q = ctx.url.searchParams.get("q") ?? "";
    const pages = engine.pages.map((p) => ({
      route: p.route,
      title: p.title,
      format: p.format,
      published: p.published,
      date: p.date ?? undefined,
      language: p.language,
    }));
    return ctx.render(<PagesIndex data={{ pages, q, prefix }} />);
  },
};

interface PageItem {
  route: string; title: string; format: string; published: boolean; date?: string; language?: string;
}

export default function PagesIndex(
  { data }: { data: { pages: PageItem[]; q: string; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Pages</h2>
      </div>
      <PageTree pages={data.pages} initialQuery={data.q} prefix={data.prefix} />
    </div>
  );
}
