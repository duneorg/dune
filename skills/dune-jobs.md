# Skill: Dune Background Jobs

Background jobs are cron-scheduled tasks defined as TypeScript files in `jobs/`. **Default auto-discovery (any `jobs/*.ts` file gets loaded and executed) is deprecated as a real code-execution risk** — write access to `jobs/` under auto-discovery is equivalent to remote code execution, since any file dropped there runs within one scheduler tick. Declare an explicit allowlist instead:

```yaml
# site.yaml — top level, not nested under a "site:" key
jobs:
  - ./jobs/weekly-digest.ts
  - ./jobs/nightly-cleanup.ts
```

Set `jobs: []` to disable all background jobs with no warning. Omitting `jobs:` entirely falls back to auto-discovery of everything under `jobs/*.ts` and logs a deprecation warning (`jobs.autodiscovery.deprecated`) on every startup where the directory exists — treat that warning as something to fix, not background noise. (`src/jobs/scanner.ts`.)

---

## Job file format

```ts
// jobs/weekly-digest.ts
import type { JobContext } from "@dune/core/jobs";

export const schedule = "0 9 * * MON";   // cron expression — required

export default async function handler(ctx: JobContext) {
  // ctx.content is a full DuneEngine, not a query API — there's no
  // ctx.content.find(). Filter/sort ctx.content.pages directly.
  const posts = ctx.content.pages
    .filter((p) => p.sourcePath.startsWith("02.blog/") && p.published)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);

  await ctx.email.send({
    to: "subscribers@example.com",
    subject: "Weekly digest",
    template: "digest",
    data: { posts },
  });
}
```

The job name is the filename stem (`weekly-digest`). One job per file — a file without a `schedule` export or a default-export handler function is silently skipped, whether or not it's on the allowlist.

### Cron expression format

```
"0 9 * * MON"     every Monday at 09:00
"0 0 * * *"       every day at midnight
"*/15 * * * *"    every 15 minutes
"0 2 1 * *"       1st of every month at 02:00
```

Standard five-field cron: `minute hour day-of-month month day-of-week`. Dune's own minimal parser (`src/jobs/cron.ts`) handles `*`, `*/n` steps, `n-m` ranges, `n,m` lists, and named days (`MON`–`SUN`). **It does not support `@` macros (`@daily`, `@hourly`), a seconds field, or `L`/`W`/`#` extensions** — those are silently either rejected or parsed incorrectly, so stick to the five plain fields above.

---

## Job context

`JobContext` is richer than plugin hook context (`HookContext`) — it's the one place in Dune that hands you a pre-built `EmailClient` and the full engine, not just `config`/`storage`:

```ts
interface JobContext {
  content: DuneEngine;    // full engine — content.pages (array), content.loadPage(sourcePath); no .find()
  contentApi: ContentApi; // .pages()/.page()/.search()/.taxonomy() — the friendlier query API
  config: DuneConfig;     // config.site.* for what other docs call "SiteConfig" fields
  storage: StorageAdapter;
  logger: JobLogger;      // info(event, data?) / warn(event, data?) / error(event, data?)
  email: EmailClient;     // real, pre-configured — see dune-email skill
}
```

**`contentApi` is always present, unlike hooks' `ctx.content`.** Jobs only ever run after a full `bootstrap()` has completed — there's no early-bootstrap window where it could be missing, so it's a required field, not optional. Both fields point at query surfaces for the same content, kept deliberately separate rather than merged: `content` is the raw engine your job may already depend on (`.pages` as a plain array property, no method call), `contentApi` is the same `ContentApi` `bootstrap.contentApi` exposes elsewhere. Prefer `contentApi` for anything beyond "iterate every page" — `.search()`/`.taxonomy()`/`.page()` aren't available on the raw engine at all.

(`src/jobs/types.ts`.) **There is no `db` field on `JobContext`, at any configuration.** If your job needs the data layer, import `@dune/core/db` directly and build your own repos from `schemas/*.yaml` — it's never injected, same as hooks (see `dune-plugin-authoring`'s note on the same fabricated "db-schema-layer" claim).

---

## File layout

```
jobs/
  weekly-digest.ts       → name: "weekly-digest", schedule: "0 9 * * MON"
  nightly-cleanup.ts     → name: "nightly-cleanup", schedule: "0 0 * * *"
  reindex-search.ts      → name: "reindex-search",  schedule: "*/30 * * * *"
```

Every file you want to actually run must also be listed in `site.yaml`'s `jobs:` array (see the top of this file) — being present in `jobs/` is not sufficient once you've moved off the deprecated auto-discovery default.

---

## Admin panel

`/admin/jobs` (UI) and `GET /admin/api/jobs` (API, requires `config.read`) list all registered jobs with:
- `lastRun` — timestamp of most recent execution, or `null` if never run
- `nextRun` — best-estimate next scheduled execution time, or `null`
- `status` — `idle` | `running` | `errored`
- `lastError` — error message from most recent failed run, or `null`

`POST /admin/api/jobs/{name}/run` (requires `config.update` + CSRF token) triggers a job immediately regardless of schedule. It fires the job asynchronously and returns `200 { triggered: true, name }` as soon as the run starts — not once it completes. A handler that throws afterward is only logged server-side (`[dune/jobs] Manual run of {name} failed: …`), not reflected in the HTTP response. Poll `GET /admin/api/jobs` afterward to see whether it actually succeeded.

**Job state is persisted as JSON files via the site's `StorageAdapter`, to `{stateDir}/{name}.json` — not Deno KV.** It survives restarts because it's on disk/storage, not because of any KV involvement.

---

## CLI

```sh
dune jobs:list              # list all registered jobs with status
dune jobs:run weekly-digest # trigger a job immediately (dev/ops use only)
```

`dune jobs:run` is for development and operational use — do not call it from application code or other job handlers.

---

## Error handling

When a handler throws, Dune (`src/jobs/scheduler.ts`):
1. Logs the error with structured output
2. Records `status: "errored"` and `lastError` in the persisted state file
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

If `workers > 1` in your deploy config and background jobs are defined, Dune emits a startup warning (`jobs.multiprocess`):

```
⚠ Background jobs are defined but workers > 1. Every worker process will
  run every job — this causes duplicate execution. Use a single worker
  process or move to a queue-backed job runner.
```

**The warning does not prevent startup.** It is your signal to either reduce to a single worker or use the escape hatch.

---

## Runtime detection

| Environment | Scheduler |
|------------|-----------|
| Deno Deploy (or anywhere `Deno.cron` exists) | `Deno.cron()` — native, platform-managed |
| Self-hosted | A minute-tick `setTimeout` loop inside `JobScheduler`, matching each job's cron expression against Dune's own parser (`src/jobs/cron.ts`) — **not an external `cron` npm/JSR library** |

The job definition format is identical in both environments; `JobScheduler.start()` detects `typeof Deno.cron === "function"` and picks the path automatically. Self-hosted resolution is whole-minute — a job scheduled for a specific minute fires within that minute's tick, not sub-minute precision.

**The cron string is parsed by two different engines depending on environment.** On Deno Deploy, `schedule` is handed straight to `Deno.cron()` — Deno's own runtime parses it, not `src/jobs/cron.ts`. Self-hosted uses Dune's minimal parser exclusively. Both accept the same plain five-field syntax shown above, but if you're relying on something exotic working because it happened to parse in one environment, verify it in the other before deploying.

---

## Escape hatch — queue-backed jobs

When you need guaranteed delivery, retry semantics, or queue-triggered execution, Dune doesn't have a built-in answer — the pattern is to replace/supplement the scheduler with BullMQ + Redis yourself:

- Use a Dune plugin hook (a real, fired one — e.g. `onPageCreate`/`onPageUpdate`, not an invented one; check `dune-plugin-authoring`'s live/dead hook list) to **enqueue** jobs into a BullMQ queue
- Run a **separate worker process** that pulls from the queue and executes handlers
- `@dune/core/email` and `@dune/core/db` remain available in that worker via direct import — construct your own `EmailClient`/db adapter there, same as anywhere outside a job/hook context

This is a DIY pattern, not something Dune ships or documents end-to-end — nothing here is verified against source because there's no source to verify; use your own judgment on the BullMQ/Redis side.

---

## Gotchas

**Auto-discovery is deprecated and a real security risk, not just legacy convenience.** Declare `jobs:` explicitly in `site.yaml`. Anyone who can write to `jobs/` on an auto-discovery site can get arbitrary code executed within a minute.

**`schedule` is required, and files not on the `jobs:` allowlist don't run even if present in `jobs/`.** Two separate reasons a file might not fire — check both.

**One job per file.** The job name comes from the filename stem. Exporting multiple schedules from one file is not supported — create separate files.

**`ctx.content` has no `.find()`.** It's the full `DuneEngine` — use `ctx.content.pages` (array) directly, or `ctx.content.loadPage(sourcePath)` for a single full `Page`. If you want something closer to a query API — `.search()`, `.taxonomy()`, filtered/ordered `.pages({...})` — use `ctx.contentApi` instead, not a method that doesn't exist on the raw engine.

**There is no `ctx.db`, ever, on any job.** Same fabricated-elsewhere claim as plugin hooks — import `@dune/core/db` yourself if you need it.

**A default 10-minute timeout applies to every job.** `JobDefinition.timeoutMs` overrides it per job; `JobScheduler`'s `defaultTimeoutMs` constructor option overrides the default globally. A run that exceeds it is treated as an error — `JobState.status` becomes `"errored"` and the job is unblocked for its next scheduled run, rather than staying stuck at `"running"` forever (which used to silently disable every future run of that job until process restart — the actual worst consequence of there being no ceiling at all).

The timeout only bounds the *scheduler's own wait* — it doesn't truly cancel a handler that ignores it. `ctx.signal` (`AbortSignal`) is aborted when the timeout fires; pass it to `fetch()` for real cancellation:

```ts
const result = await fetch(url, { signal: ctx.signal });
```

Set a shorter or longer `timeoutMs` per job when 10 minutes isn't the right ceiling:

```ts
export const timeoutMs = 30_000; // 30 seconds for a job that should always be fast

export default async function handler(ctx: JobContext) {
  await fetch("https://api.example.com/sync", { signal: ctx.signal });
}
```

**No retry on error.** Errors are logged and the job waits for its next scheduled run. If your job sends an email or charges a card and fails halfway through, you need idempotency logic in the handler — not retry configuration.

**No `@` macros, seconds field, or `L`/`W`/`#` cron extensions.** Dune's parser only supports the five plain fields shown above.

**Multi-process duplicates are silent after the one startup warning.** Each worker runs each job independently with no coordination. Verify your worker count before deploying jobs to production — don't rely on remembering the warning.
