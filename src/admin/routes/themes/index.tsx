/** @jsxImportSource preact */
/** GET /admin/themes — installed themes */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { config, prefix } = getAdminContext();
    return ctx.render(<ThemesRoute data={{ activeTheme: config.theme.name, prefix }} />);
  },
};

export default function ThemesRoute(
  { data }: { data: { activeTheme: string; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Themes</h2>
        <a href={`${data.prefix}/marketplace?tab=themes`} class="btn">Browse Marketplace</a>
      </div>
      <p style="color:#718096;font-size:14px;margin-bottom:16px">Active theme: <strong>{data.activeTheme}</strong></p>
    </div>
  );
}
