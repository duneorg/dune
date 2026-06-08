/**
 * Section registry — holds all registered SectionDef instances.
 * Built-in sections are pre-loaded; custom sections can be added at runtime.
 */

import { BUILT_IN_SECTIONS } from "./built-in.ts";
import type { SectionDef } from "./types.ts";

/**
 * Registry of {@link SectionDef} instances for the Visual Page Builder.
 * Use the shared {@link sectionRegistry} singleton, or create a new instance
 * for isolated testing.
 */
export class SectionRegistry {
  private readonly defs = new Map<string, SectionDef>();

  constructor() {
    for (const def of BUILT_IN_SECTIONS) {
      this.defs.set(def.type, def);
    }
  }

  register(def: SectionDef): void {
    this.defs.set(def.type, def);
  }

  get(type: string): SectionDef | undefined {
    return this.defs.get(type);
  }

  all(): SectionDef[] {
    return Array.from(this.defs.values());
  }
}

/** Shared singleton used by the admin server and renderer */
export const sectionRegistry: SectionRegistry = new SectionRegistry();
