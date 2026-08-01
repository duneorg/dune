import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createTranslator } from "../../src/i18n/translate.ts";

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = Deno.env.get(key);
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
  try {
    fn();
  } finally {
    if (prev === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prev);
  }
}

Deno.test("createTranslator: returns the string when the key is present, ignoring any fallback", () => {
  const t = createTranslator({ "greeting.a": "Hello" });
  assertEquals(t("greeting.a"), "Hello");
  assertEquals(t("greeting.a", "Howdy"), "Hello");
});

Deno.test("createTranslator: returns the fallback when the key is missing and a fallback is given", () => {
  const t = createTranslator({});
  assertEquals(t("greeting.b", "Howdy"), "Howdy");
});

Deno.test("createTranslator: returns the raw key outside production when missing with no fallback", () => {
  withEnv("DUNE_ENV", undefined, () => {
    const t = createTranslator({});
    assertEquals(t("greeting.c"), "greeting.c");
  });
});

Deno.test("createTranslator: returns empty string in production when missing with no fallback", () => {
  withEnv("DUNE_ENV", "production", () => {
    const t = createTranslator({});
    assertEquals(t("greeting.d"), "");
  });
});

Deno.test("createTranslator: production still honors an explicit fallback", () => {
  withEnv("DUNE_ENV", "production", () => {
    const t = createTranslator({});
    assertEquals(t("greeting.e", "Howdy"), "Howdy");
  });
});
