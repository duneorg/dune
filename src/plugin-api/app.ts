/**
 * The route-registration surface of the contract: what a plugin's `mount()`
 * sees of the Fresh `App`, and of the request context its handlers receive.
 *
 * Core's real `App` and `FreshContext` satisfy these structurally, so the
 * contract names no Fresh type and pins no Fresh version. Only what plugins
 * demonstrably use is here: registering middleware and routes, and reading the
 * request, URL, route parameters and per-request state.
 *
 * A plugin that needs more (`ctx.render()`, islands, `app.fsRoutes()`,
 * `app.layout()`) depends on Fresh itself and narrows what it is given:
 * handler properties in the contract are declared as methods, so a handler
 * that takes a full `FreshContext` is accepted where a `PluginRouteContext` is
 * expected, and `app` can be cast to Fresh's `App`. Core always passes the
 * real thing; the cost of narrowing is that such a plugin follows Fresh's
 * versions, which this contract no longer promises to.
 *
 * @module
 */

/** What a route handler or middleware receives. Core passes a Fresh `FreshContext`, which satisfies this. */
export interface PluginRouteContext<
  // deno-lint-ignore no-explicit-any
  S = any,
> {
  /** The incoming request. */
  readonly req: Request;
  /** The request URL, parsed. */
  readonly url: URL;
  /** Route parameters, e.g. `{ id: "7" }` for `/items/:id`. */
  readonly params: Record<string, string>;
  /** Per-request state shared by middleware and handlers. */
  state: S;
  /** Run the rest of the chain and return its response (middleware only). */
  next(): Promise<Response>;
}

/** A route handler or middleware. */
// deno-lint-ignore no-explicit-any
export type PluginRouteHandler<S = any> = (
  ctx: PluginRouteContext<S>,
) => Response | Promise<Response>;

/** What `mount()` receives as `app`. Core passes the Fresh `App`, which satisfies this. */
export interface PluginApp {
  /** Register middleware that runs for every request (or every request below a path). */
  use(...handlers: PluginRouteHandler[]): this;
  use(path: string, ...handlers: PluginRouteHandler[]): this;
  /** Register route handlers for a method and path (`/items/:id` style). */
  get(path: string, ...handlers: PluginRouteHandler[]): this;
  post(path: string, ...handlers: PluginRouteHandler[]): this;
  put(path: string, ...handlers: PluginRouteHandler[]): this;
  patch(path: string, ...handlers: PluginRouteHandler[]): this;
  delete(path: string, ...handlers: PluginRouteHandler[]): this;
  /** Match any method. */
  all(path: string, ...handlers: PluginRouteHandler[]): this;
}
