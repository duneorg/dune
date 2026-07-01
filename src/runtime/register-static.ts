import type { App } from "fresh";
import type { BootstrapResult } from "./bootstrap.ts";
import {
  serveStaticFile,
  servePluginAsset,
  withSecurityHeaders,
} from "../cli/serve-utils.ts";
import {
  buildPluginClientBundles,
  serveClientBundle,
} from "../cli/client-bundles.ts";

type ClientBundles = Awaited<ReturnType<typeof buildPluginClientBundles>>;

type RenderJsx = (jsx: unknown, status?: number) => Promise<Response>;

interface DuneRoutes {
  contentHandler(req: Request, render: RenderJsx): Promise<Response>;
  mediaHandler(req: Request): Promise<Response>;
}

export interface StaticRouteOptions {
  root: string;
  dev: boolean;
  clientBundles: ClientBundles;
  routes: DuneRoutes;
}

function makeRenderJsx(render: (vnode: unknown) => Response | Promise<Response>): RenderJsx {
  return async (jsx: unknown, statusCode = 200): Promise<Response> => {
    const res = await render(jsx);
    if (statusCode === 200) return res;
    return new Response(res.body, { status: statusCode, headers: res.headers });
  };
}

/**
 * Register static file routes: favicon, robots.txt, /static/*, /themes/*, /plugins/*,
 * and /content-media/*. Falls through to contentHandler when no static asset matches.
 */
export function registerStaticRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
  opts: StaticRouteOptions,
): void {
  const { root, dev, clientBundles, routes } = opts;
  const { imageHandler, pluginAssetDirs, sharedThemesDir } = ctx;

  app.get("/favicon.ico", async () => {
    const result = await serveStaticFile(root, "/favicon.ico", dev);
    return withSecurityHeaders(result ?? new Response(null, { status: 404 }));
  });

  app.get("/favicon.svg", async () => {
    const result = await serveStaticFile(root, "/favicon.svg", dev);
    return withSecurityHeaders(result ?? new Response(null, { status: 404 }));
  });

  app.get("/robots.txt", async () => {
    const result = await serveStaticFile(root, "/robots.txt", dev);
    return withSecurityHeaders(result ?? new Response(null, { status: 404 }));
  });

  // /static/* and /themes/* fall through to content resolution when no file matches.
  // This handles the case where a content page has the same name as a static prefix.
  app.get("/static/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });

  app.get("/themes/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });

  // Plugin assets: bundled client entries first, then static assetDir files.
  // Falls through to content when nothing matches.
  app.get("/plugins/*", async (fc) => {
    const bundleResult = serveClientBundle(clientBundles, fc.url.pathname, fc.req, dev);
    if (bundleResult) return withSecurityHeaders(bundleResult);
    const result = await servePluginAsset(pluginAssetDirs, fc.url.pathname, dev);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });

  // Legacy co-located content media path.
  app.get("/content-media/*", async (fc) => {
    const imageResult = await imageHandler(fc.req);
    return imageResult ?? await routes.mediaHandler(fc.req);
  });
}
