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
  SearchServices,
  SecurityService,
  SessionService,
  UserService,
} from "./services.ts";
export { createPluginServices } from "./create-services.ts";
export type {
  AdminPrefix,
  AuthenticateResult,
  CapabilityContext,
  CapabilityFactory,
  CapabilityKey,
  CapabilityProvider,
  CapabilityReader,
  CapabilityRegistrar,
  Capabilities,
  RequestAuthenticator,
  ScheduledActionExecutor,
} from "./capabilities.ts";
export { adminPrefixOf, capabilityKey, createCapabilityRegistry } from "./capabilities.ts";
export type { CapabilityRegistry } from "./capabilities.ts";
export type { PluginApp, PluginRouteContext, PluginRouteHandler } from "./app.ts";
export type { PluginRuntime } from "./runtime.ts";
export { type DuneErrorCode, isDuneError } from "./errors.ts";
