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

/** Apps that already have the routes, so a second call is a no-op. */
const registered = new WeakSet<object>();

/**
 * Register `GET/POST /api/forms/:name` and
 * `POST /api/webhook/incoming` on a Fresh app.
 *
 * `createDuneApp()` does this itself. Call it directly only if you assemble
 * the app yourself from `bootstrap()` (headless mode). Calling it twice for
 * the same app is harmless.
 */
export function registerFormRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
): void {
  if (registered.has(app)) return;
  registered.add(app);
  const rt = createFormsRuntime(ctx);
  app.get("/api/forms/:name", (fc) => handleFormSchema(rt, fc.params.name));
  app.post("/api/forms/:name", (fc) => handleFormSubmission(rt, fc.req, fc.params.name));
  app.post("/api/webhook/incoming", (fc) => handleIncomingWebhook(rt, fc.req));
}
