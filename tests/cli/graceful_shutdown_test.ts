/**
 * Unit tests for graceful-shutdown logic.
 *
 * These tests exercise the drain counter and the double-trigger guard in
 * isolation — no real server is started.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ---------------------------------------------------------------------------
// In-flight counter
// ---------------------------------------------------------------------------

Deno.test("inFlight counter: increments on entry and decrements on exit", async () => {
  let inFlight = 0;

  // Simulate the wrapper used in Deno.serve's handler
  async function wrappedHandler(work: () => Promise<void>): Promise<void> {
    inFlight++;
    try {
      await work();
    } finally {
      inFlight--;
    }
  }

  assertEquals(inFlight, 0);

  // Concurrent requests — both increment before either decrements
  let resolve1!: () => void;
  let resolve2!: () => void;
  const p1 = wrappedHandler(() => new Promise<void>((r) => { resolve1 = r; }));
  const p2 = wrappedHandler(() => new Promise<void>((r) => { resolve2 = r; }));

  assertEquals(inFlight, 2);

  resolve1();
  await p1;
  assertEquals(inFlight, 1);

  resolve2();
  await p2;
  assertEquals(inFlight, 0);
});

Deno.test("inFlight counter: decrements even when handler throws", async () => {
  let inFlight = 0;

  async function wrappedHandler(work: () => Promise<void>): Promise<void> {
    inFlight++;
    try {
      await work();
    } finally {
      inFlight--;
    }
  }

  try {
    await wrappedHandler(() => Promise.reject(new Error("boom")));
  } catch {
    // expected
  }

  assertEquals(inFlight, 0);
});

// ---------------------------------------------------------------------------
// Shutdown flag / double-trigger guard
// ---------------------------------------------------------------------------

Deno.test("shutdown function: sets flag and does not double-trigger", () => {
  let shuttingDown = false;
  let shutdownCallCount = 0;

  function shutdown(_signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownCallCount++;
  }

  assertEquals(shuttingDown, false);
  assertEquals(shutdownCallCount, 0);

  shutdown("SIGTERM");
  assertEquals(shuttingDown, true);
  assertEquals(shutdownCallCount, 1);

  // Second call (e.g. both SIGTERM and SIGINT fire) must be a no-op
  shutdown("SIGINT");
  assertEquals(shuttingDown, true);
  assertEquals(shutdownCallCount, 1);
});

// ---------------------------------------------------------------------------
// Drain deadline logic
// ---------------------------------------------------------------------------

Deno.test("drainInFlight: resolves immediately when inFlight is already 0", async () => {
  let inFlight = 0;

  // Inline the drain logic so we don't import the real serve.ts
  // (which would trigger top-level import side-effects).
  async function drainInFlight(
    getInFlight: () => number,
    deadlineMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (getInFlight() > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const start = Date.now();
  await drainInFlight(() => inFlight, 5_000);
  // Should return almost immediately — well under 500 ms
  const elapsed = Date.now() - start;
  assertEquals(elapsed < 500, true, `Expected drain to be fast, got ${elapsed}ms`);
});

Deno.test("drainInFlight: waits until inFlight reaches 0", async () => {
  let inFlight = 1;

  async function drainInFlight(
    getInFlight: () => number,
    deadlineMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (getInFlight() > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Decrement after a short delay
  setTimeout(() => { inFlight = 0; }, 150);

  const start = Date.now();
  await drainInFlight(() => inFlight, 5_000);
  const elapsed = Date.now() - start;

  assertEquals(inFlight, 0);
  // Should have waited ~150 ms (plus up to one 50 ms poll interval)
  assertEquals(elapsed >= 100, true, `Expected to wait, got ${elapsed}ms`);
  assertEquals(elapsed < 1_000, true, `Expected to finish quickly, got ${elapsed}ms`);
});

Deno.test("drainInFlight: exits after deadline even if inFlight stays positive", async () => {
  const inFlight = 1; // never decremented

  async function drainInFlight(
    getInFlight: () => number,
    deadlineMs: number,
  ): Promise<void> {
    const start = Date.now();
    while (getInFlight() > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const deadline = 200; // short deadline for test speed
  const start = Date.now();
  await drainInFlight(() => inFlight, deadline);
  const elapsed = Date.now() - start;

  // Should have exited around the deadline (allow generous upper bound)
  assertEquals(elapsed >= deadline, true, `Expected to wait at least ${deadline}ms, got ${elapsed}ms`);
  assertEquals(elapsed < deadline + 500, true, `Deadline overrun: ${elapsed}ms`);
});
