/** @jsxImportSource preact */
/** GET /admin/jobs — background jobs dashboard */

import { h } from "preact";
import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";
import type { JobState } from "../../../jobs/types.ts";
import type { JobScheduler } from "../../../jobs/scheduler.ts";

interface PageData {
  jobs: JobState[];
  prefix: string;
}

function statusBadge(status: JobState["status"]) {
  const styles: Record<string, string> = {
    idle: "background:#e2e8f0;color:#4a5568",
    running: "background:#bee3f8;color:#2b6cb0",
    errored: "background:#fed7d7;color:#c53030",
  };
  return (
    <span style={`${styles[status] ?? styles.idle};padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600`}>
      {status}
    </span>
  );
}

function fmtDate(ts: number | null) {
  if (ts === null) return "—";
  return new Date(ts).toLocaleString();
}

export default function JobsPage({ data }: { data: PageData }) {
  const { jobs, prefix } = data;

  return (
    <div>
      <div class="section-header">
        <h2>Background Jobs</h2>
      </div>

      {jobs.length === 0 && (
        <p style="color:#718096;padding:2rem 0">
          No jobs registered. Create a <code>jobs/</code> directory in your project root and add job files.
        </p>
      )}

      {jobs.length > 0 && (
        <table class="admin-table" style="width:100%">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Last run</th>
              <th>Next run</th>
              <th>Last error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.name}>
                <td><code style="font-size:0.875rem">{job.name}</code></td>
                <td>{statusBadge(job.status)}</td>
                <td style="font-size:0.875rem;color:#4a5568">{fmtDate(job.lastRun)}</td>
                <td style="font-size:0.875rem;color:#4a5568">{fmtDate(job.nextRun)}</td>
                <td style="font-size:0.8rem;color:#c53030;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  {job.lastError ?? "—"}
                </td>
                <td>
                  <form method="post" action={`${prefix}/api/jobs/${job.name}/run`} style="display:inline">
                    <button
                      type="submit"
                      style="padding:4px 12px;font-size:0.8rem;border:1px solid #cbd5e0;border-radius:4px;background:white;cursor:pointer"
                      title="Trigger this job now"
                    >
                      Run now
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style="font-size:0.75rem;color:#a0aec0;margin-top:1rem">
        Jobs are triggered automatically by their cron schedule. "Run now" fires the job immediately regardless of schedule.
      </p>
    </div>
  );
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>): Promise<Response> {
    const { prefix } = ctx.state.adminContext;
    const { jobScheduler } = ctx.state.adminContext as typeof ctx.state.adminContext & {
      jobScheduler?: JobScheduler;
    };

    if (!ctx.state.adminContext.auth.hasPermission(ctx.state.auth, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }

    const jobs = jobScheduler ? await jobScheduler.listStatus() : [];
    return ctx.render(<JobsPage data={{ jobs, prefix }} />);
  },
};
