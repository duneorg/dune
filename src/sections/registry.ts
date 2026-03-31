/**
 * Section registry — holds all registered SectionDef instances.
 * Built-in sections are pre-loaded; custom sections can be added at runtime.
 */

import { BUILT_IN_SECTIONS } from "./built-in.ts";
import type { SectionDef } from "./types.ts";

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
export const sectionRegistry = new SectionRegistry();
