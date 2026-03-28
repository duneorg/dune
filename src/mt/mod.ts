/**
 * Machine translation module — re-exports all public types and classes.
 */

export type { MachineTranslator, MachineTranslationConfig } from "./types.ts";
export { DeepLTranslator } from "./deepl.ts";
export { GoogleTranslator } from "./google.ts";
export { LibreTranslateTranslator } from "./libretranslate.ts";
export { createMachineTranslator } from "./factory.ts";
