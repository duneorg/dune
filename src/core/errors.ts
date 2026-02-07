/**
 * Custom error classes for Dune CMS.
 * All errors include actionable messages telling the user what to do.
 */

export class DuneError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DuneError";
  }
}

export class ConfigError extends DuneError {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly line?: number,
  ) {
    const location = filePath
      ? ` in ${filePath}${line ? `:${line}` : ""}`
      : "";
    super(`Config error${location}: ${message}`, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}

export class ContentError extends DuneError {
  constructor(
    message: string,
    public readonly sourcePath?: string,
  ) {
    const location = sourcePath ? ` [${sourcePath}]` : "";
    super(`Content error${location}: ${message}`, "CONTENT_ERROR");
    this.name = "ContentError";
  }
}

export class StorageError extends DuneError {
  constructor(message: string, public readonly path?: string) {
    const location = path ? ` (${path})` : "";
    super(`Storage error${location}: ${message}`, "STORAGE_ERROR");
    this.name = "StorageError";
  }
}

export class TemplateError extends DuneError {
  constructor(
    message: string,
    public readonly templateName?: string,
  ) {
    const tpl = templateName ? ` [${templateName}]` : "";
    super(`Template error${tpl}: ${message}`, "TEMPLATE_ERROR");
    this.name = "TemplateError";
  }
}

export class RouteError extends DuneError {
  constructor(message: string, public readonly route?: string) {
    const r = route ? ` [${route}]` : "";
    super(`Route error${r}: ${message}`, "ROUTE_ERROR");
    this.name = "RouteError";
  }
}
