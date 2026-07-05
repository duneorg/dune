/**
 * Blueprint system — frontmatter schema validation for typed content models.
 *
 * @module
 */

export type {
  BlueprintDefinition,
  BlueprintField,
  BlueprintFieldType,
  BlueprintFieldValidation,
  BlueprintMap,
  BlueprintValidationError,
  ResolvedBlueprint,
} from "./types.ts";

export { loadBlueprints } from "./loader.ts";
export { validateFrontmatter, resolveBlueprint } from "./validator.ts";
