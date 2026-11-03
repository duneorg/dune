/**
 * Register the public form and incoming-webhook routes.
 *
 * Called unconditionally by `createDuneApp`, like `registerFeeds`, so these
 * work with or without an admin plugin. With no `forms/` directory an unknown
 * form is a 404; with no `webhooks.incoming` the webhook is a 501.
 *
 * @module
 */

import type { App } from "fresh";
import type { BootstrapResult } from "../runtime/bootstrap.ts";
import { resolveFormsConfig } from "./config.ts";
import {
  createSubmissionRateLimiter,
  type FormsRuntime,
  handleContactSubmission,
  handleFormSchema,
  handleFormSubmission,
  handleIncomingWebhook,
} from "./handlers.ts";
import { createSubmissionNotifier } from "./notify.ts";

/** Build the handlers' runtime from a bootstrap result. */
export function createFormsRuntime(ctx: BootstrapResult): FormsRuntime {
  const forms = resolveFormsConfig(ctx.config);
  return {
    storage: ctx.storage,
    config: ctx.config,
    forms,
    submissions: ctx.submissions,
    notifier: createSubmissionNotifier(ctx.config, forms),
    hooks: ctx.hooks,
    rateLimiter: createSubmissionRateLimiter(),
    engine: ctx.engine,
    imageCache: ctx.imageCache,
  };
}

export function registerFormRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
): void {
  const rt = createFormsRuntime(ctx);
  app.post("/api/contact", (fc) => handleContactSubmission(rt, fc.req));
  app.get("/api/forms/:name", (fc) => handleFormSchema(rt, fc.params.name));
  app.post("/api/forms/:name", (fc) => handleFormSubmission(rt, fc.req, fc.params.name));
  app.post("/api/webhook/incoming", (fc) => handleIncomingWebhook(rt, fc.req));
}
