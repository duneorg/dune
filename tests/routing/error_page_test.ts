import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { duneRoutes } from "../../src/routing/routes.ts";
import { renderErrorPage } from "../../src/routing/error-page.ts";
import type { DuneEngine, ResolveResult } from "../../src/core/engine.ts";
import type { Page, PageIndex } from "../../src/content/types.ts";
import type { DuneConfig, SiteConfig } from "../../src/config/types.ts";

// ---------------------------------------------------------------------------
// Stub helpers (mirrors tests/routing/routes_test.ts)
// ---------------------------------------------------------------------------

const stubSite: SiteConfig = {
  title: "Test Site",
  description: "Test",
  url: "https://example.com",
  author: { name: "Test Author" },
  metadata: {},
  taxonomies: ["tag"],
  routes: {},
  redirects: {},
  cors_origins: [],
};

const stubConfig: DuneConfig = {
  site: stubSite,
  system: {
    content: {
      dir: "content",
      markdown: { extra: false, auto_links: false, auto_url_links: false },
    },
    cache: { enabled: false, driver: "memory", lifetime: 0, check: "none" },
    images: { default_quality: 80, cache_dir: ".cache", allowed_sizes: [] },
    languages: { supported: ["en"], default: "en", include_default_in_url: false },
    debug: false,
    timezone: "UTC",
  },
  theme: { name: "default", custom: {} },
  plugins: {},
  pluginList: [],
};

function makeEngine(
  pages: PageIndex[],
  resolveOverride?: (route: string) => Promise<ResolveResult>,
): DuneEngine {
  return {
    config: stubConfig,
    site: stubSite,
    pages,
    blueprints: {},
    taxonomyMap: {},
    router: {
      getNavigation: (_lang?: string) => [],
      getTopNavigation: (_lang?: string) => [],
      getTranslations: (_route: string) => [],
      resolve: (_pathname: string) => ({ type: "not-found" as const }),
    } as unknown as DuneEngine["router"],
    themes: {
      theme: {} as unknown,
      resolveTemplateName: (_page: Page) => null,
      loadTemplate: (_name: string) => Promise.resolve(null),
      loadLayout: (_name: string) => Promise.resolve(null),
      loadLocale: (_lang: string) => Promise.resolve({} as Record<string, string>),
      clearCache: () => {},
    } as unknown as DuneEngine["themes"],
    init: () => Promise.resolve(),
    resolve: resolveOverride ?? ((_route: string) => Promise.resolve({ type: "not-found" as const })),
    loadPage: (_sourcePath: string) => Promise.reject(new Error("not implemented")),
    serveMedia: (_mediaPath: string) => Promise.resolve(null),
    rebuild: () => Promise.resolve(),
    themeConfig: {},
    getAvailableThemes: () => Promise.resolve([]),
    switchTheme: (_name: string) => Promise.resolve(),
    createPreviewTheme: (_name: string) => Promise.reject(new Error("not implemented")),
    setPluginTemplateDirs: (_dirs: string[]) => {},
    storage: {} as unknown as DuneEngine["storage"],
  };
}

/** Install a themes stub whose loadTemplate("error") returns a capturing component. */
function withErrorTemplate(engine: DuneEngine, captured: { props?: Record<string, unknown> }) {
  engine.themes = {
    ...engine.themes,
    loadTemplate: (name: string) => {
      if (name !== "error") return Promise.resolve(null);
      return Promise.resolve({
        name: "error",
        component: (props: Record<string, unknown>) => {
          captured.props = props;
          return null;
        },
        fromTheme: "default",
      });
    },
    loadLayout: (_name: string) => Promise.resolve(null),
    loadLocale: (_lang: string) => Promise.resolve({}),
  } as unknown as DuneEngine["themes"];
}

// ---------------------------------------------------------------------------
// Tests — themed error template
// ---------------------------------------------------------------------------

Deno.test("contentHandler: 404 uses theme error template with statusCode/message frontmatter", async () => {
  const engine = makeEngine([], async (_route: string) => ({ type: "not-found" as const }));
  const captured: { props?: Record<string, unknown> } = {};
  withErrorTemplate(engine, captured);

  const { contentHandler } = duneRoutes(engine);

  let capturedStatus: number | undefined;
  const renderJsx = (_jsx: unknown, status?: number): Response => {
    capturedStatus = status;
    return new Response("rendered", { status: status ?? 200 });
  };

  const req = new Request("http://localhost/no-such-page");
  const res = await contentHandler(req, renderJsx);

  assertEquals(res.status, 404);
  assertEquals(capturedStatus, 404);

  // Force render of the JSX tree so the template component runs.
  const { renderToString } = await import("preact-render-to-string");
  // renderJsx above didn't render — call renderErrorPage directly to assert props.
  await renderErrorPage(
    engine,
    new URL("http://localhost/no-such-page"),
    async (jsx, status) => {
      renderToString(jsx as never);
      return new Response("ok", { status });
    },
    404,
    "Page not found",
  );

  assertExists(captured.props);
  const page = captured.props!.page as Page;
  assertEquals(page.frontmatter.statusCode, 404);
  assertEquals(page.frontmatter.message, "Page not found");
  assertEquals(page.route, "/no-such-page");
  // Usual TemplateProps are present
  assertEquals(captured.props!.site, stubSite);
  assertEquals(captured.props!.config, stubConfig);
  assertExists(captured.props!.nav);
  assertExists(captured.props!.t);
  assertEquals(captured.props!.dir, "ltr");
});

Deno.test("renderErrorPage: 500 passes statusCode 500 to error template", async () => {
  const engine = makeEngine([]);
  const captured: { props?: Record<string, unknown> } = {};
  withErrorTemplate(engine, captured);

  const { renderToString } = await import("preact-render-to-string");
  let capturedStatus: number | undefined;
  const res = await renderErrorPage(
    engine,
    new URL("http://localhost/broken.tsx"),
    async (jsx, status) => {
      capturedStatus = status;
      renderToString(jsx as never);
      return new Response("ok", { status });
    },
    500,
    "TSX component not found",
  );

  assertEquals(res.status, 500);
  assertEquals(capturedStatus, 500);
  assertExists(captured.props);
  const page = captured.props!.page as Page;
  assertEquals(page.frontmatter.statusCode, 500);
  assertEquals(page.frontmatter.message, "TSX component not found");
});

Deno.test("renderErrorPage: falls back to hardcoded markup when no error template exists", async () => {
  const engine = makeEngine([]); // themes stub returns null for all templates/layouts

  const { renderToString } = await import("preact-render-to-string");
  let html = "";
  const res = await renderErrorPage(
    engine,
    new URL("http://localhost/missing"),
    async (jsx, status) => {
      html = renderToString(jsx as never);
      return new Response(html, { status });
    },
    404,
    "Page not found",
  );

  assertEquals(res.status, 404);
  // Standalone fallback (no layout): full document with the status code
  assertEquals(html.includes("404"), true);
  assertEquals(html.includes("Page not found"), true);
  assertEquals(html.includes("/missing"), true);
});

Deno.test("renderErrorPage: wraps fallback body in theme layout when layout exists", async () => {
  const engine = makeEngine([]);
  let layoutRan = false;
  engine.themes = {
    ...engine.themes,
    loadTemplate: (_name: string) => Promise.resolve(null),
    loadLayout: (_name: string) =>
      Promise.resolve((props: { children?: unknown }) => {
        layoutRan = true;
        return props.children as never;
      }),
    loadLocale: (_lang: string) => Promise.resolve({}),
  } as unknown as DuneEngine["themes"];

  const { renderToString } = await import("preact-render-to-string");
  let html = "";
  const res = await renderErrorPage(
    engine,
    new URL("http://localhost/missing"),
    async (jsx, status) => {
      html = renderToString(jsx as never);
      return new Response(html, { status });
    },
    404,
    "Page not found",
  );

  assertEquals(res.status, 404);
  assertEquals(layoutRan, true);
  assertEquals(html.includes("content-page"), true);
});
