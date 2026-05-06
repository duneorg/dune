/** @jsxImportSource preact */
/** GET /admin/marketplace — plugin + theme marketplace */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import Marketplace from "../../islands/Marketplace.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const tab = ctx.url.searchParams.get("tab") ?? "plugins";
    return ctx.render(<MarketplaceRoute data={{ tab, prefix: getAdminContext().prefix }} />);
  },
};

export default function MarketplaceRoute(
  { data }: { data: { tab: string; prefix: string } },
) {
  return (
    <div>
      <div class="section-header"><h2>Marketplace</h2></div>
      <Marketplace prefix={data.prefix} initialTab={data.tab} />
    </div>
  );
}
