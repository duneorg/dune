/**
 * The plugin-facing contract: service interfaces, error identity, and the
 * factory core uses to build the services.
 *
 * @module
 */
export type {
  AuthzService,
  BlueprintService,
  EngineServices,
  PasswordService,
  PathServices,
  PluginServices,
  PluginServicesOptions,
  RateLimitService,
  SecurityService,
  SessionService,
  UserService,
} from "./services.ts";
export { createPluginServices } from "./create-services.ts";
export { type DuneErrorCode, isDuneError } from "./errors.ts";
