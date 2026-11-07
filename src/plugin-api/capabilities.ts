/**
 * The capability registry: what a plugin *provides* to core and to other
 * plugins (#97).
 *
 * `PluginServices` go the other way: core implements them, a plugin uses them.
 * A capability is implemented by a plugin and used by core or another plugin,
 * and is optional by nature: when no plugin provides it, the consumer carries on
 * without that feature. Core never looks a provider up by plugin name.
 *
 * Two shapes:
 *  - a **slot** has at most one active provider (an object implementing the
 *    contract in {@link Capabilities}); a later registration replaces an
 *    earlier one, with a warning. The exception is {@link EXCLUSIVE_SLOTS}
 *    (`editor.session`): a second plugin providing one is a conflict that stops
 *    the boot, because the provider decides who is treated as an editor (the
 *    admin bar, editing markers, the inline-edit WebSocket) and load order
 *    must not;
 *  - a **contribution point** collects one item from each contributing plugin
 *    ({@link Contributions}).
 *
 * Plugins declare in `setup()`; core resolves every slot factory once, after
 * all `setup()`s have settled and core infrastructure exists, in registration
 * order. A factory that throws is logged and leaves its slot empty; the site
 * keeps serving.
 *
 * @module
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { HistoryEngine } from "../history/mod.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { InlineEditManager } from "../inline-edit/types.ts";
import type { ScheduledAction } from "../workflow/types.ts";
import type { PluginServices } from "./services.ts";
import { logger } from "../core/logger.ts";

// ── Contracts ────────────────────────────────────────────────────────────────

/** The result of authenticating a request as an admin-tier session. */
export interface AuthenticateResult {
  authenticated: boolean;
  /**
   * The signed-in admin. Only `id` is guaranteed: `username` is absent for
   * OAuth/magic-link accounts, so a consumer that needs a display name falls
   * back to `name`, then `email`, then `id`.
   */
  user?: { id: string; username?: string; email?: string; name?: string; roles?: string[] };
}

/** Tells core whether a request carries an authenticated admin session. */
export interface RequestAuthenticator {
  /**
   * Resolve the admin session of a request. Core calls this on public pages
   * (for the admin bar and to decide whether editing markers survive), so it
   * must answer quickly, without touching a session store, when the request
   * carries no session of its own.
   */
  authenticate(req: Request): Promise<AuthenticateResult>;
  /**
   * Names of the cookies that carry this provider's session. Core uses them for
   * two cheap decisions that must not depend on a particular admin: whether to
   * call {@link authenticate} at all, and whether to keep a response out of the
   * shared page cache (a response rendered for an editor must never be served
   * to anonymous visitors). Declare them to keep that precise; when omitted,
   * core treats any request with a `Cookie` header as possibly signed in.
   */
  readonly sessionCookies?: readonly string[];
}

/** Runs a due scheduled action (publish, unpublish, archive). */
export interface ScheduledActionExecutor {
  execute(action: ScheduledAction): Promise<void>;
}

/**
 * Where the admin lives. Core never assumes an admin exists or where it is
 * mounted: it reads this slot to keep admin routes out of the page cache, the
 * static build and the plugin-route namespace. No provider means no admin.
 */
export interface AdminPrefix {
  /** URL path prefix the admin is mounted at: starts with `/`, no trailing slash (e.g. `/admin`). */
  readonly prefix: string;
}

/**
 * Slots: what core itself consumes, or what every plugin may rely on.
 *
 * Open to declaration merging. A plugin that offers an extension point of its
 * own declares the key next to its types, so core's contract does not grow with
 * every plugin's features:
 *
 * ```ts
 * declare module "@dune/plugin-api" {
 *   interface Capabilities { "admin.editor": ContentEditorPlugin }
 * }
 * ```
 *
 * The rule: **a key is prefixed with the name of the plugin that consumes it**
 * (`admin.*` is the admin's, `bar.*` plugin-inline-edit's). Unprefixed
 * namespaces (`editor`, `scheduler`, `admin.prefix`) belong to core.
 * Core never reads a key it did not declare.
 */
export interface Capabilities {
  /** Where the admin is mounted. Consumers: core's request handling, static build and plugin-route registration. */
  "admin.prefix": AdminPrefix;
  /** Who is treated as an editor on this request. Consumers: the admin bar's response transform, the inline-edit WebSocket. */
  "editor.session": RequestAuthenticator;
  /** Executes due scheduled actions. Consumer: `dune serve`, which owns the scheduler's polling loop. */
  "scheduler.executor": ScheduledActionExecutor;
  /** Real-time inline editing. Consumers: core's `/api/inline-edit/ws`, the admin. */
  "editor.inline": InlineEditManager;
}

/**
 * Contribution points: one item from each contributing plugin. Open to
 * declaration merging under the same rule as {@link Capabilities}. Core
 * declares none: every point today belongs to the plugin that reads it.
 */
// deno-lint-ignore no-empty-interface
export interface Contributions {}

/** What a slot factory receives: core infrastructure that exists once `setup()`s have settled. */
export interface CapabilityContext {
  storage: StorageAdapter;
  config: DuneConfig;
  history: HistoryEngine;
  /** The engine's hook registry; a factory that writes content fires the matching `onPage*` event itself. */
  hooks: HookRegistry;
  services: PluginServices;
  /** Plugin runtime data directory (`admin.runtime_dir`). */
  dataDir: string;
  /** Content directory relative to the site root. */
  contentDir: string;
}

/** Slot factory: may be async. Returning `undefined` declines the slot. */
export type CapabilityFactory<T> = (ctx: CapabilityContext) => T | undefined | Promise<T | undefined>;

// ── Plugin-facing API ────────────────────────────────────────────────────────

/** `PluginApi.capabilities`: how a plugin declares what it provides. */
export interface CapabilityRegistrar {
  provide<K extends keyof Capabilities>(name: K, factory: CapabilityFactory<Capabilities[K]>): void;
  contribute<K extends keyof Contributions>(point: K, item: Contributions[K]): void;
}

/** One entry of {@link CapabilityReader.providers}. */
export interface CapabilityProvider {
  name: string;
  kind: "slot" | "contribution";
  /** Name of the plugin that registered it. */
  provider: string;
  /** Slots only: `unresolved` before resolution, `active`, `declined` (factory returned undefined) or `failed` (factory threw). */
  status: "unresolved" | "active" | "declined" | "failed";
}

/** `MountApi.capabilities` / `BootstrapResult.capabilities`: how core and plugins consume them. */
export interface CapabilityReader {
  /** The active provider of a slot, or undefined (nobody provides it, it declined, it failed, or resolution has not run). */
  get<K extends keyof Capabilities>(name: K): Capabilities[K] | undefined;
  /** Everything contributed to a point, in plugin registration order. */
  list<K extends keyof Contributions>(point: K): readonly Contributions[K][];
  /** Who provides what, for `dune doctor`. */
  providers(): CapabilityProvider[];
}

/**
 * Slots where two different plugins providing the same one is an error, not a
 * replacement. `editor.session` decides who is treated as an editor on a request
 * (the admin bar, editing markers, the inline-edit WebSocket, bypassing the
 * shared page cache); `admin.prefix` decides which paths core keeps out of the
 * page cache and away from plugin routes. The winner of either must not depend
 * on plugin load order: one admin per site.
 */
export const EXCLUSIVE_SLOTS: ReadonlySet<string> = new Set(["editor.session", "admin.prefix"]);

/** An {@link EXCLUSIVE_SLOTS} slot that more than one plugin tried to provide. */
export interface CapabilityConflict {
  capability: string;
  /** Every plugin that provided it, in registration order. */
  providers: string[];
}

/** The message that stops a boot with a {@link CapabilityConflict}. */
export function describeConflict(c: CapabilityConflict): string {
  const names = c.providers.map((p) => `"${p}"`).join(", ");
  return `More than one plugin provides "${c.capability}" (${names}). A site has one, and which ` +
    `plugin wins must not depend on load order. Remove or disable all but one.`;
}

/** Core-side registry: the registrar and reader views plus the resolution step. */
export interface CapabilityRegistry {
  /** A registrar that attributes everything it registers to `provider` (a plugin name). */
  registrar(provider: string): CapabilityRegistrar;
  reader: CapabilityReader;
  /** Exclusive slots that more than one plugin provided; the boot must not go on while this is not empty. */
  conflicts(): CapabilityConflict[];
  /** Run the slot factories that have not run yet, in registration order. Never throws. */
  resolve(ctx: CapabilityContext): Promise<void>;
}

/**
 * The admin URL prefix, or `null` when no plugin provides one (or the provided
 * value is not a usable prefix). Read it lazily: slots resolve after `setup()`.
 */
export function adminPrefixOf(reader: CapabilityReader): string | null {
  const prefix = reader.get("admin.prefix")?.prefix;
  if (typeof prefix !== "string") return null;
  if (!isUsablePrefix(prefix)) {
    logger.warn("capabilities.admin_prefix_invalid", { prefix });
    return null;
  }
  return prefix;
}

function isUsablePrefix(prefix: string): boolean {
  return prefix.length >= 2 && prefix.startsWith("/") && !prefix.endsWith("/");
}

/**
 * The value an active `admin.prefix` provider returned when it is not a usable
 * path, else `null`. `resolveCapabilities()` turns this into a boot error:
 * quietly treating a bad prefix as "no admin" would stop core reserving the
 * admin's paths (page cache, response transforms, route shadowing) while the
 * admin still serves them.
 */
export function invalidAdminPrefix(reader: CapabilityReader): unknown | null {
  const slot = reader.get("admin.prefix");
  if (slot === undefined) return null;
  const prefix = (slot as { prefix?: unknown }).prefix;
  return typeof prefix === "string" && isUsablePrefix(prefix) ? null : (prefix ?? "(missing)");
}

// ── Implementation ───────────────────────────────────────────────────────────

interface SlotEntry {
  provider: string;
  factory: CapabilityFactory<unknown>;
  status: CapabilityProvider["status"];
  value?: unknown;
}

export function createCapabilityRegistry(): CapabilityRegistry {
  const slots = new Map<string, SlotEntry>();
  const contributions = new Map<string, { provider: string; item: unknown }[]>();
  const conflicts = new Map<string, CapabilityConflict>();
  let resolving = false;

  const reader: CapabilityReader = {
    get(name) {
      const slot = slots.get(name);
      return slot?.status === "active" ? slot.value as never : undefined;
    },
    list(point) {
      return (contributions.get(point) ?? []).map((c) => c.item) as never;
    },
    providers() {
      const out: CapabilityProvider[] = [];
      for (const [name, s] of slots) out.push({ name, kind: "slot", provider: s.provider, status: s.status });
      for (const [name, list] of contributions) {
        for (const c of list) out.push({ name, kind: "contribution", provider: c.provider, status: "active" });
      }
      return out;
    },
  };

  return {
    reader,

    conflicts: () => [...conflicts.values()],

    registrar(provider) {
      return {
        provide(name, factory) {
          const previous = slots.get(name);
          if (previous && EXCLUSIVE_SLOTS.has(name) && previous.provider !== provider) {
            // Keep the first provider; the boot stops on the conflict (see conflicts()).
            const c = conflicts.get(name) ?? { capability: name, providers: [previous.provider] };
            if (!c.providers.includes(provider)) c.providers.push(provider);
            conflicts.set(name, c);
            logger.error("capabilities.slot_conflict", { capability: name, providers: c.providers.join(", ") });
            return;
          }
          if (previous) {
            logger.warn("capabilities.slot_replaced", { capability: name, replaced: previous.provider, by: provider });
            // Delete first so the winning entry takes its place at the end of the order.
            slots.delete(name);
          }
          if (resolving) logger.warn("capabilities.provided_late", { capability: name, provider });
          slots.set(name, { provider, factory: factory as CapabilityFactory<unknown>, status: "unresolved" });
        },
        contribute(point, item) {
          const list = contributions.get(point) ?? [];
          list.push({ provider, item });
          contributions.set(point, list);
        },
      };
    },

    async resolve(ctx) {
      resolving = true;
      for (const [name, slot] of [...slots]) {
        if (slot.status !== "unresolved") continue;
        try {
          const value = await slot.factory(ctx);
          if (value === undefined) {
            slot.status = "declined";
          } else {
            slot.value = value;
            slot.status = "active";
          }
        } catch (err) {
          slot.status = "failed";
          logger.error("capabilities.provider_failed", {
            capability: name,
            provider: slot.provider,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  };
}
