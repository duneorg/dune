/**
 * Theme system type definitions.
 */

import type { TemplateComponent } from "../content/types.ts";

/** Theme manifest loaded from theme.yaml */
export interface ThemeManifest {
  /** Theme name (directory name) */
  name: string;
  /** Parent theme for inheritance */
  parent?: string;
  /** Human-readable description */
  description?: string;
  /** Theme author */
  author?: string;
  /** Theme version */
  version?: string;
}

/** A resolved theme with all its templates, components, and layouts */
export interface ResolvedTheme {
  /** Theme manifest */
  manifest: ThemeManifest;
  /** Base directory of this theme */
  dir: string;
  /** Parent theme (if inheritance is used) */
  parent?: ResolvedTheme;
  /** Available template names (e.g., ["default", "post", "blog"]) */
  templateNames: string[];
  /** Available layout names (e.g., ["default", "landing"]) */
  layoutNames: string[];
}

/** Loaded template component ready for rendering */
export interface LoadedTemplate {
  /** Template name */
  name: string;
  /** The Preact/JSX component */
  component: TemplateComponent;
  /** Which theme it was loaded from (for debugging) */
  fromTheme: string;
}
