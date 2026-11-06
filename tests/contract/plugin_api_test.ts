/**
 * `@dune/plugin-api` is a leaf package that redeclares the plugin contract.
 * These tests keep core and the package from drifting apart. They are mostly
 * compile-time: `deno check` is the assertion.
 *
 * Two directions (plugin-api extraction plan, decision 10):
 *  - what core hands a plugin is assignable to the package's types;
 *  - what a plugin hands in (an engine, an editor manager, a record) is
 *    accepted by core.
 * Types that are identical on both sides are checked both ways.
 */

import { assertEquals } from "@std/assert";
import type * as P from "@dune/plugin-api";
import { isDuneError as pluginIsDuneError } from "@dune/plugin-api";
import type { PageIndex } from "../../src/content/types.ts";
import type {
  ContentApi,
  ContentSearchResult,
  PagesOptions,
  ResolvedPage,
  TaxonomyTerm,
} from "../../src/content/api.ts";
import type {
  FacetCounts,
  InjectedSearchRecord,
  SearchEngine,
  SearchEngineCreateContext,
  SearchFilter,
  SearchOptions,
  SearchRecordsCollectContext,
  SearchResult,
} from "../../src/search/engine.ts";
import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "../../src/storage/types.ts";
import type { Submission, SubmissionFile, SubmissionMeta, SubmissionStatus } from "../../src/forms/submissions.ts";
import type { BlueprintField } from "../../src/blueprints/types.ts";
import type { InlineEditManager } from "../../src/inline-edit/types.ts";
import type { ScheduledAction } from "../../src/workflow/types.ts";
import type { PluginApp, PluginRouteContext } from "../../src/plugin-api/app.ts";
import type { PluginServices } from "../../src/plugin-api/services.ts";
import type { User, UserCreate } from "../../src/auth/types.ts";
import type { UserStore } from "../../src/auth/user-store.ts";
import type { Session } from "../../src/session/types.ts";
import type { SessionManager } from "../../src/session/mod.ts";
import type { HistoryEngine } from "../../src/history/engine.ts";
import type { ContentDiff, ContentRevision } from "../../src/workflow/types.ts";
import type { WorkflowEngine } from "../../src/workflow/engine.ts";
import type { Scheduler } from "../../src/workflow/scheduler.ts";
import type { StagingEngine } from "../../src/staging/engine.ts";
import type { RateLimiter } from "../../src/security/rate-limit.ts";
import type { RateLimitStore } from "../../src/security/rate-limit-store.ts";
import type { Logger } from "../../src/core/logger.ts";
import { isDuneError as coreIsDuneError } from "../../src/plugin-api/errors.ts";

// Both directions: identical on both sides.
function same<A, B>(..._ok: [A] extends [B] ? ([B] extends [A] ? [] : [never]) : [never]): void {}
// Core -> package only: core hands out something wider.
function handsOut<Core extends Pkg, Pkg>(): void {}
// Package -> core only: a plugin supplies it and core consumes it.
function takesIn<Pkg extends Core, Core>(): void {}

// --- what core hands a plugin ---------------------------------------------
handsOut<PageIndex, P.PageIndex>();
handsOut<ContentApi, P.ContentApi>();
handsOut<ResolvedPage, P.ResolvedPage>();
handsOut<ContentSearchResult, P.ContentSearchResult>();
handsOut<TaxonomyTerm, P.TaxonomyTerm>();
handsOut<PagesOptions, P.PagesOptions>();
handsOut<SearchEngineCreateContext, P.SearchEngineCreateContext>();
handsOut<SearchRecordsCollectContext, P.SearchRecordsCollectContext>();

handsOut<PluginServices, P.PluginServices>();
handsOut<HistoryEngine, P.HistoryEngine>();
handsOut<WorkflowEngine, P.WorkflowEngine>();
handsOut<Scheduler, P.Scheduler>();
handsOut<StagingEngine, P.StagingEngine>();
handsOut<RateLimiter, P.RateLimiter>();
handsOut<Logger, P.Logger>();

// --- what a plugin hands in -----------------------------------------------
takesIn<P.SearchEngine, SearchEngine>();
takesIn<P.InjectedSearchRecord, InjectedSearchRecord>();
takesIn<P.InlineEditManager, InlineEditManager>();

// --- identity: a provider supplies its own stores and cores consumes them -
same<User, P.User>();
same<UserCreate, P.UserCreate>();
same<UserStore, P.UserStore>();
same<Session, P.Session>();
same<SessionManager, P.SessionManager>();
same<ContentRevision, P.ContentRevision>();
same<ContentDiff, P.ContentDiff>();
same<RateLimitStore, P.RateLimitStore>();

// --- identical both ways ---------------------------------------------------
same<StorageAdapter, P.StorageAdapter>();
same<StorageEntry, P.StorageEntry>();
same<StorageStat, P.StorageStat>();
same<WatchEvent, P.WatchEvent>();
same<Submission, P.Submission>();
same<SubmissionFile, P.SubmissionFile>();
same<SubmissionMeta, P.SubmissionMeta>();
same<SubmissionStatus, P.SubmissionStatus>();
same<BlueprintField, P.BlueprintField>();
same<ScheduledAction, P.ScheduledAction>();
same<SearchResult, P.SearchResult>();
same<SearchFilter, P.SearchFilter>();
same<SearchOptions, P.SearchOptions>();
same<FacetCounts, P.FacetCounts>();
same<PluginApp, P.PluginApp>();
same<PluginRouteContext, P.PluginRouteContext>();

Deno.test("isDuneError behaves the same in the package and in core", () => {
  const err = { code: "ssrf_blocked" };
  for (const code of ["ssrf_blocked", "body_too_large", "weak_password", "duplicate_email"] as const) {
    assertEquals(pluginIsDuneError(err, code), coreIsDuneError(err, code));
  }
  assertEquals(pluginIsDuneError(new Error("x"), "ssrf_blocked"), false);
});
