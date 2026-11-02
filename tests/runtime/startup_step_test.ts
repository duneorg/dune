import { assertEquals, assertRejects } from "@std/assert";
import { startupStep } from "../../src/runtime/startup-step.ts";

Deno.test("startupStep: returns the step's value", async () => {
  assertEquals(await startupStep("Failed to x", () => Promise.resolve(42)), 42);
});

Deno.test("startupStep: failure is labelled and keeps the original as cause", async () => {
  const original = new Error("EACCES");
  const err = await assertRejects(
    () => startupStep("Failed to load plugins", () => Promise.reject(original)),
    Error,
    "Failed to load plugins: EACCES",
  );
  assertEquals(err.cause, original);
});
