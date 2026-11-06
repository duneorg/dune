import { assertEquals } from "@std/assert";
import type { HookEvent } from "../../src/hooks/types.ts";

// These four were declared but nothing ever fired them, so a handler for one
// never ran. They are gone from the union: registering one is a type error
// instead of a silent no-op. (Re-adding an event later is additive; removing
// one after 1.0 would be breaking.)
Deno.test("the four never-fired hook events are no longer HookEvents", () => {
  // @ts-expect-error removed: never fired
  const a: HookEvent = "onRouteResolved";
  // @ts-expect-error removed: never fired
  const b: HookEvent = "onPageLoaded";
  // @ts-expect-error removed: never fired
  const c: HookEvent = "onAfterRender";
  // @ts-expect-error removed: never fired
  const d: HookEvent = "onResponse";
  assertEquals([a, b, c, d].length, 4);

  // The request-lifecycle events that do fire are still there.
  const kept: HookEvent[] = ["onRequest", "onCollectionResolved", "onBeforeRender"];
  assertEquals(kept.length, 3);
});
