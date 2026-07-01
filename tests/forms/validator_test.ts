/**
 * Tests for the form submission validator.
 *
 * Covers required fields, per-type format checks, and — importantly — length
 * validation for "email" fields, which previously regressed because a
 * duplicate `case "email"` in the type switch shadowed the length checks.
 */

import { assertEquals } from "@std/assert";
import { validateFormSubmission } from "../../src/forms/validator.ts";
import type { FormDefinition } from "../../src/forms/types.ts";

function form(fields: FormDefinition["fields"]): FormDefinition {
  return { title: "Test", fields };
}

Deno.test("validator: required field missing produces an error", () => {
  const def = form({ name: { type: "text", label: "Name", required: true } });
  const errors = validateFormSubmission(def, { name: "" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "name");
});

Deno.test("validator: optional empty field passes", () => {
  const def = form({ name: { type: "text", label: "Name" } });
  assertEquals(validateFormSubmission(def, { name: "" }), []);
});

Deno.test("validator: invalid email format is rejected", () => {
  const def = form({ email: { type: "email", label: "Email" } });
  const errors = validateFormSubmission(def, { email: "not-an-email" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "email");
});

Deno.test("validator: valid email format passes", () => {
  const def = form({ email: { type: "email", label: "Email" } });
  assertEquals(validateFormSubmission(def, { email: "user@example.com" }), []);
});

// Regression: email fields must also enforce min/max length. A duplicate
// `case "email"` previously shadowed these checks, so they never ran.
Deno.test("validator: email field enforces max length", () => {
  const def = form({
    email: { type: "email", label: "Email", validate: { max: 10 } },
  });
  const errors = validateFormSubmission(def, { email: "very.long.address@example.com" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "email");
});

Deno.test("validator: email field enforces min length", () => {
  const def = form({
    email: { type: "email", label: "Email", validate: { min: 50 } },
  });
  // Format is valid but shorter than the required minimum length.
  const errors = validateFormSubmission(def, { email: "a@b.co" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "email");
});

Deno.test("validator: text field enforces min/max length", () => {
  const def = form({
    bio: { type: "text", label: "Bio", validate: { min: 3, max: 5 } },
  });
  assertEquals(validateFormSubmission(def, { bio: "ok" }).length, 1);
  assertEquals(validateFormSubmission(def, { bio: "toolong" }).length, 1);
  assertEquals(validateFormSubmission(def, { bio: "good" }), []);
});

Deno.test("validator: number field enforces numeric + range", () => {
  const def = form({
    age: { type: "number", label: "Age", validate: { min: 18, max: 99 } },
  });
  assertEquals(validateFormSubmission(def, { age: "abc" }).length, 1);
  assertEquals(validateFormSubmission(def, { age: "5" }).length, 1);
  assertEquals(validateFormSubmission(def, { age: "150" }).length, 1);
  assertEquals(validateFormSubmission(def, { age: "42" }), []);
});

Deno.test("validator: select field rejects values outside options", () => {
  const def = form({
    color: {
      type: "select",
      label: "Color",
      options: { red: "Red", blue: "Blue" },
    },
  });
  assertEquals(validateFormSubmission(def, { color: "green" }).length, 1);
  assertEquals(validateFormSubmission(def, { color: "red" }), []);
});
