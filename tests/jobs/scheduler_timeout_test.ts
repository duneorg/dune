/**
 * Tests for JobScheduler's per-job timeout enforcement.
 *
 * Before this, a hung handler (infinite loop, a fetch() that never
 * resolves) ran forever with no ceiling — and worse, left JobState.status
 * stuck at "running" permanently, silently blocking every future scheduled
 * run of that job until process restart (executeJob()'s own guard: "if
 * state.status === 'running', warn and return"). A timeout now bounds the
 * scheduler's own wait and unblocks future runs by treating a timeout the
 * same as any other handler error.
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { DEFAULT_JOB_TIMEOUT_MS, JobScheduler } from "../../src/jobs/scheduler.ts";
import type { JobContext, JobDefinition } from "../../src/jobs/types.ts";

async function withTempDir(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_job_timeout_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const noop = () => {};
function baseContext(): Omit<JobContext, "signal"> {
  return {
    // deno-lint-ignore no-explicit-any
    content: {} as any,
    // deno-lint-ignore no-explicit-any
    contentApi: {} as any,
    // deno-lint-ignore no-explicit-any
    config: {} as any,
    // deno-lint-ignore no-explicit-any
    storage: {} as any,
    logger: { info: noop, warn: noop, error: noop },
    email: { send: async () => {} } as JobContext["email"],
  };
}

Deno.test("JobScheduler: DEFAULT_JOB_TIMEOUT_MS is 10 minutes", () => {
  assertEquals(DEFAULT_JOB_TIMEOUT_MS, 10 * 60_000);
});

Deno.test("JobScheduler: a handler that finishes well under its timeout succeeds normally", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    const def: JobDefinition = {
      name: "quick",
      schedule: "0 0 * * *",
      timeoutMs: 200,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 1));
      },
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
    });

    await scheduler.run("quick");

    const [state] = await scheduler.listStatus();
    assertEquals(state.status, "idle");
    assertEquals(state.lastError, null);
  });
});

Deno.test("JobScheduler: a handler exceeding its timeout is marked errored, not stuck running", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    const def: JobDefinition = {
      name: "hangs",
      schedule: "0 0 * * *",
      timeoutMs: 20,
      handler: () => new Promise(() => {}), // never resolves
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
    });

    await scheduler.run("hangs");

    const [state] = await scheduler.listStatus();
    assertEquals(state.status, "errored");
    assertMatch(state.lastError ?? "", /timed out after 20ms/);
  });
});

Deno.test("JobScheduler: timing out unblocks the next scheduled run (was stuck at 'running' forever before)", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    let runs = 0;
    const def: JobDefinition = {
      name: "hangs-once",
      schedule: "0 0 * * *",
      timeoutMs: 20,
      handler: () => {
        runs++;
        if (runs === 1) return new Promise(() => {}); // hangs on first run only
        return Promise.resolve();
      },
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
    });

    await scheduler.run("hangs-once");
    let [state] = await scheduler.listStatus();
    assertEquals(state.status, "errored");

    // Without the timeout fix, this second run would see status === "running"
    // (stuck forever from the first) and silently no-op instead of executing.
    await scheduler.run("hangs-once");
    [state] = await scheduler.listStatus();
    assertEquals(state.status, "idle");
    assertEquals(runs, 2);
  });
});

Deno.test("JobScheduler: ctx.signal is aborted when the timeout fires", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    let sawAborted = false;
    const def: JobDefinition = {
      name: "checks-signal",
      schedule: "0 0 * * *",
      timeoutMs: 20,
      handler: (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            sawAborted = true;
            resolve();
          });
        }),
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
    });

    await scheduler.run("checks-signal");

    assertEquals(sawAborted, true);
  });
});

Deno.test("JobScheduler: ctx.signal is NOT aborted when the handler finishes in time", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    let sawSignal = false;
    const def: JobDefinition = {
      name: "finishes-fine",
      schedule: "0 0 * * *",
      timeoutMs: 500,
      handler: (ctx) => {
        sawSignal = ctx.signal.aborted;
        return Promise.resolve();
      },
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
    });

    await scheduler.run("finishes-fine");

    assertEquals(sawSignal, false);
  });
});

Deno.test("JobScheduler: defaultTimeoutMs applies when JobDefinition.timeoutMs is unset", async () => {
  await withTempDir(async (root) => {
    const storage = createStorage({ rootDir: root });
    const def: JobDefinition = {
      name: "uses-default",
      schedule: "0 0 * * *",
      handler: () => new Promise(() => {}), // never resolves
    };
    const scheduler = new JobScheduler({
      definitions: [def],
      context: baseContext(),
      stateDir: "jobs",
      storage,
      defaultTimeoutMs: 15,
    });

    await scheduler.run("uses-default");

    const [state] = await scheduler.listStatus();
    assertEquals(state.status, "errored");
    assertMatch(state.lastError ?? "", /timed out after 15ms/);
  });
});
