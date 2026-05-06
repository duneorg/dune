/** @jsxImportSource preact */
/** GET /admin/users — user management */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import UserManager from "../../islands/UserManager.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { auth, prefix } = getAdminContext();
    if (!auth.hasPermission(ctx.state.auth, "users.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<UsersRoute data={{ prefix }} />);
  },
};

export default function UsersRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header"><h2>Users</h2></div>
      <UserManager prefix={data.prefix} />
    </div>
  );
}
