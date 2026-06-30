/** @jsxImportSource preact */
/**
 * Built-in block editor — the default ContentEditorPlugin loaded by bootstrap
 * when no plugin overrides adminServices.contentEditor.
 *
 * Wraps the PageEditor island in the same way the old hardwired route did, but
 * now as a proper ContentEditorPlugin so it participates in the same slot that
 * third-party editors use.
 */

import { h } from "preact";
import type { ContentEditorPlugin } from "./types.ts";
import PageEditor from "./islands/PageEditor.tsx";

function PageEditorRoute(
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

export function createBlockEditorPlugin(): ContentEditorPlugin {
  return {
    pageEditorHandler(ctx) {
      const { engine, prefix } = ctx.state.adminContext;
      const pagePath = ctx.url.searchParams.get("path");
      if (!pagePath) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${prefix}/pages` },
        });
      }
      const pageIndex = engine.pages.find((p) => p.route === pagePath);
      return ctx.render(
        <PageEditorRoute data={{ pagePath, pageIndex, prefix }} />,
      );
    },
  };
}
