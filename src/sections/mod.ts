/**
 * Dune Visual Page Builder section types and registry.
 * @module
 */
export type {
  /** Schema definition for a section type */
  SectionDef,
  /** A field definition within a section schema */
  SectionField,
  /** Supported field types for section fields */
  SectionFieldType,
  /** A section instance stored in page frontmatter under `sections:` */
  SectionInstance,
} from "./types.ts";
export { BUILT_IN_SECTIONS } from "./built-in.ts";
export {
  /** Registry of {@link SectionDef} instances for the Visual Page Builder. */
  SectionRegistry,
  /** Shared singleton used by the admin server and renderer */
  sectionRegistry,
} from "./registry.ts";
export {
  /** Render an array of SectionInstance objects to an HTML string. */
  renderSections,
} from "./renderer.ts";
