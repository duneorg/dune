/**
 * Content format handler registry.
 *
 * Manages pluggable ContentFormatHandler implementations.
 * The engine registers handlers at startup; lookup is by file extension.
 */

import { ContentError } from "../../core/errors.ts";
import type { ContentFormatHandler } from "../types.ts";

export class FormatRegistry {
  private handlers = new Map<string, ContentFormatHandler>();

  /**
   * Register a format handler.
   * Each extension in handler.extensions is mapped to this handler.
   * Throws if an extension is already registered.
   */
  register(handler: ContentFormatHandler): void {
    for (const ext of handler.extensions) {
      const normalized = ext.startsWith(".") ? ext : `.${ext}`;
      if (this.handlers.has(normalized)) {
        throw new ContentError(
          `Format handler for "${normalized}" is already registered`,
        );
      }
      this.handlers.set(normalized, handler);
    }
  }

  /**
   * Get the handler for a given file extension.
   * Returns null if no handler is registered for this extension.
   */
  get(extension: string): ContentFormatHandler | null {
    const normalized = extension.startsWith(".") ? extension : `.${extension}`;
    return this.handlers.get(normalized) ?? null;
  }

  /**
   * Get the handler for a given file path (extracts extension).
   */
  getForFile(filePath: string): ContentFormatHandler | null {
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot === -1) return null;
    const ext = filePath.slice(lastDot);
    return this.get(ext);
  }

  /**
   * Check if a file extension has a registered handler.
   */
  supports(extension: string): boolean {
    return this.get(extension) !== null;
  }

  /**
   * Check if a file path has a registered handler.
   */
  supportsFile(filePath: string): boolean {
    return this.getForFile(filePath) !== null;
  }

  /**
   * Get all supported file extensions.
   */
  supportedExtensions(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Get all registered handlers (deduplicated).
   */
  allHandlers(): ContentFormatHandler[] {
    return [...new Set(this.handlers.values())];
  }
}
