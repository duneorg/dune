/**
 * Regression test for JobContext.contentApi (added 0.31.7).
 *
 * Constructs a real JobScheduler against a real bootstrap()'d site (same
 * shape src/cli/serve.ts and src/cli/jobs.ts build in production) and
 * proves a job handler actually receives a working ContentApi, not just
 * that the field type-checks.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries (same caveat as other tests that call it directly) —
 * sanitizeOps/sanitizeResources off.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { JobScheduler } from "../../src/jobs/scheduler.ts";
import type { JobContext, JobDefinition } from "../../src/jobs/types.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_job_content_api_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "JobContext.contentApi: a job handler receives a working ContentApi",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\nHello\n",
      );

      const ctx = await bootstrap(root, {});

      const noop = () => {};
      const jobContext: JobContext = {
        content: ctx.engine,
        contentApi: ctx.contentApi,
        config: ctx.config,
        storage: ctx.storage,
        logger: { info: noop, warn: noop, error: noop },
        email: { send: async () => {} } as JobContext["email"],
      };

      let seenHasContentApi = false;
      let seenRoutes: string[] = [];
      const def: JobDefinition = {
        name: "probe",
        schedule: "0 0 * * *",
        handler: async (jctx) => {
          seenHasContentApi = jctx.contentApi === ctx.contentApi;
          seenRoutes = jctx.contentApi.pages().map((p) => p.route);
        },
      };

      const scheduler = new JobScheduler({
        definitions: [def],
        context: jobContext,
        stateDir: join(root, ".dune", "admin", "jobs"),
        storage: ctx.storage,
      });

      await scheduler.run("probe");

      assertEquals(seenHasContentApi, true);
      assertEquals(seenRoutes, ["/home/"]);
    });
  },
);
