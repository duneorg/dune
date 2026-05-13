# Skill: Dune Background Jobs

Background jobs are cron-scheduled tasks defined as TypeScript files in `jobs/`. Dune scans `jobs/*.ts` on startup and auto-registers all files that export a `schedule` and a default handler. No registration step required.

Queue-triggered jobs (enqueue / dequeue) are out of scope — see the escape hatch section if you need them.

---

## Job file format

```ts
// jobs/weekly-digest.ts
import type { JobContext } from "@dune/core";

export const schedule = "0 9 * * MON";   // cron expression — required

export default async function handler(ctx: JobContext) {
  const posts = await ctx.content.find({ type: "post", limit: 5 });
  await ctx.email.send({
    to: "subscribers@example.com",
    subject: "Weekly digest",
    template: "digest",
    data: { posts },
  });
}
```

The job name is the filename stem (`weekly-digest`). One job per file.

### Cron expression format

```
"0 9 * * MON"     every Monday at 09:00
"0 0 * * *"       every day at midnight
"*/15 * * * *"    every 15 minutes
"0 2 1 * *"       1st of every month at 02:00
```

Standard five-field cron: `minute hour day-of-month month day-of-week`.

---

## Job context

`JobContext` is the same surface as plugin hook context:

```ts
interface JobContext {
  content: ContentAPI;   // query the content index
  email: EmailAPI;       // send transactional email
  db: DbAPI;             // query app data
  config: SiteConfig;    // read site.yaml values
  logger: Logger;        // structured logging
}
```

---

## File layout

```
jobs/
  weekly-digest.ts       → name: "weekly-digest", schedule: "0 9 * * MON"
  nightly-cleanup.ts     → name: "nightly-cleanup", schedule: "0 0 * * *"
  reindex-search.ts      → name: "reindex-search",  schedule: "*/30 * * * *"
```

---

## Admin panel

`/admin/jobs` lists all registered jobs with:
- `lastRun` — timestamp of most recent execution
- `nextRun` — next scheduled execution time
- `status` — `idle` | `running` | `errored`
- `lastError` — error message from most recent failed run
- **Manual trigger button** — runs the job immediately regardless of schedule

Job state is persisted in Deno KV and survives restarts.

---

## CLI

```sh
dune jobs:list              # list all registered jobs with status
dune jobs:run weekly-digest # trigger a job immediately (dev/ops use only)
```

`dune jobs:run` is for development and operational use — do not call it from application code or other job handlers.

---

## Error handling

When a handler throws, Dune:
1. Logs the error with structured output
2. Records `status: errored` and `lastError` message in Deno KV
3. Continues scheduling future runs — **no retry**

The next scheduled run is the natural retry for transient failures. For jobs that must not miss an execution or must retry on failure, use the escape hatch.

Handle expected errors explicitly in the handler rather than letting them propagate:

```ts
export default async function handler(ctx: JobContext) {
  try {
    await sendDigest(ctx);
  } catch (err) {
    ctx.logger.error("jobs.digest_failed", { error: String(err) });
    // optionally alert — email, webhook, etc.
  }
}
```

---

## Multi-process warning

If `workers > 1` in your deploy config and background jobs are defined, Dune emits a startup warning:

```
⚠ Background jobs are defined but workers > 1. Every worker process will
  run every job — this causes duplicate execution. Use a single worker
  process or move to a queue-backed job runner (see docs/deployment/jobs).
```

**The warning does not prevent startup.** It is your signal to either reduce to a single worker or use the escape hatch.

---

## Runtime detection

| Environment | Scheduler |
|------------|-----------|
| Deno Deploy | `Deno.cron()` — native, zero infra |
| Self-hosted | `cron` library — same job format, no config change |

The job definition format is identical in both environments. Dune handles detection.

---

## Escape hatch — queue-backed jobs

When you need guaranteed delivery, retry semantics, or queue-triggered execution, replace the Dune scheduler with BullMQ + Redis:

- Use a Dune plugin hook (e.g. `onPagePublish`) to **enqueue** jobs into a BullMQ queue
- Run a **separate worker process** that pulls from the queue and executes handlers
- Dune's `jobs/` directory and `email.send()` / `db.*` remain available in the worker via direct import

Dune does not own the queue — it documents the pattern. See `docs/deployment/jobs` for the full setup.

---

## Gotchas

**`schedule` is required.** A file in `jobs/` without an exported `schedule` constant is silently ignored — it won't be registered and won't appear in `dune jobs:list`.

**One job per file.** The job name comes from the filename stem. Exporting multiple schedules from one file is not supported — create separate files.

**No timeout enforcement.** If a handler hangs indefinitely, Dune doesn't kill it. Add your own timeout logic for jobs that call external services:

```ts
const result = await Promise.race([
  fetchExternalData(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
]);
```

**No retry on error.** Errors are logged and the job waits for its next scheduled run. If your job sends an email or charges a card and fails halfway through, you need idempotency logic in the handler — not retry configuration.

**`db` in job context requires db-schema-layer.** Same constraint as plugin hooks — `ctx.db` throws if no DB is configured. Guard with `ctx.config.db?.enabled` if your job is db-optional.

**Multi-process duplicates are silent.** The startup warning fires once. After that, each worker runs each job independently with no coordination. Do not rely on the warning alone — verify your worker count before deploying jobs to production.
