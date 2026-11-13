import { assertEquals } from "@std/assert";
import { startScheduledActions } from "../../src/cli/serve-utils.ts";
import { createCapabilityRegistry } from "../../src/plugin-api/capabilities.ts";
import type { CapabilityContext } from "../../src/plugin-api/capabilities.ts";
import type { ScheduledAction } from "../../src/workflow/types.ts";

function fakeScheduler() {
  const calls = {
    started: 0,
    handler: undefined as ((a: ScheduledAction) => Promise<void>) | undefined,
  };
  return {
    calls,
    scheduler: {
      start(handler: (a: ScheduledAction) => Promise<void>) {
        calls.started++;
        calls.handler = handler;
      },
      stop() {},
    },
  };
}

Deno.test("startScheduledActions: without a scheduler.executor provider nothing starts", async () => {
  const reg = createCapabilityRegistry();
  await reg.resolve({} as CapabilityContext);
  const { scheduler, calls } = fakeScheduler();
  const started = startScheduledActions({
    capabilities: reg.reader,
    pluginServices: { engines: { scheduler } as never },
  });
  assertEquals(started, false);
  assertEquals(calls.started, 0);
});

Deno.test("startScheduledActions: a provider's executor runs the actions core's scheduler hands it", async () => {
  const reg = createCapabilityRegistry();
  const executed: string[] = [];
  reg.registrar("admin").provide("scheduler.executor", () => ({
    execute: (a) => {
      executed.push(a.id);
      return Promise.resolve();
    },
  }));
  await reg.resolve({} as CapabilityContext);
  const { scheduler, calls } = fakeScheduler();

  const started = startScheduledActions({
    capabilities: reg.reader,
    pluginServices: { engines: { scheduler } as never },
  });

  assertEquals(started, true);
  assertEquals(calls.started, 1);
  await calls.handler!(
    {
      id: "act-1",
      action: "publish",
      sourcePath: "content/a.md",
      scheduledAt: 0,
    } as ScheduledAction,
  );
  assertEquals(executed, ["act-1"]);
});
