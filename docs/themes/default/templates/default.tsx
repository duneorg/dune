/** @jsxImportSource preact */

/**
 * Default template — renders markdown content pages.
 *
 * The content handler pre-resolves page.html() and passes it as
 * `children` (a dangerouslySetInnerHTML div). This avoids async
 * rendering issues in Preact components.
 */

import type { TemplateProps } from "../../../../src/content/types.ts";
import StaticLayout from "../components/layout.tsx";

export default function DefaultTemplate({ page, site, config, pathname, Layout, children }: TemplateProps & { Layout?: any }) {
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent page={page} site={site} config={config} pathname={pathname}>
      <article>
        {children}
      </article>
    </LayoutComponent>
  );
}
