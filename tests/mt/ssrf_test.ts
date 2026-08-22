import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LibreTranslateTranslator } from "../../src/mt/libretranslate.ts";

Deno.test("LibreTranslateTranslator: refuses a private destination via safeFetch", async () => {
  const mt = new LibreTranslateTranslator("http://169.254.169.254");
  await assertRejects(
    () => mt.translate("hello", "en", "es"),
    Error,
    "LibreTranslate",
  );
});
