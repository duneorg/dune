import { assertEquals } from "@std/assert";
import { formatErrorChain } from "../../src/cli/error-format.ts";

Deno.test("formatErrorChain: a plain error is just its message", () => {
  assertEquals(formatErrorChain(new Error("boom")), ["boom"]);
});

Deno.test("formatErrorChain: non-Error values are stringified", () => {
  assertEquals(formatErrorChain("just a string"), ["just a string"]);
});

Deno.test("formatErrorChain: prints one `caused by` line per cause", () => {
  const root = new Error("Connection refused");
  const mid = new Error("error sending request for url (http://127.0.0.1:7700/indexes)", {
    cause: root,
  });
  const top = new TypeError("fetch failed", { cause: mid });
  assertEquals(formatErrorChain(top), [
    "fetch failed",
    "  caused by: error sending request for url (http://127.0.0.1:7700/indexes)",
    "  caused by: Connection refused",
  ]);
});

Deno.test("formatErrorChain: skips a cause whose text the message already carries", () => {
  const cause = new Error("Connection refused");
  const top = new Error(`Search engine "meilisearch" failed to build: Connection refused`, {
    cause,
  });
  assertEquals(formatErrorChain(top), [top.message]);
});

Deno.test("formatErrorChain: survives a cause cycle", () => {
  const a = new Error("a");
  const b = new Error("b", { cause: a });
  (a as { cause?: unknown }).cause = b;
  assertEquals(formatErrorChain(a), ["a", "  caused by: b"]);
});
