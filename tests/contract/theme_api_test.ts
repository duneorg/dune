/**
 * `@dune/theme-api` is a leaf package that redeclares the theme contract.
 * These tests keep core and the package from drifting apart. They are mostly
 * compile-time: `deno check` is the assertion. The helpers are not compared at
 * runtime: `@dune/core/theme-helpers` is removed (duneorg/dune#136), and the package's
 * own tests carry the helper cases.
 *
 * Two directions (see the plugin-api extraction plan, decision 10):
 *  - what core hands a template is assignable to the package's types;
 *  - a template written against the package's types is accepted by core.
 */

import type * as Theme from "@dune/theme-api";
import type {
  Collection,
  Page,
  PageIndex,
  PageTranslation,
  TemplateComponent,
  TemplateProps,
} from "../../src/content/types.ts";

// --- core -> package: what core hands out ---------------------------------

const _props = (p: TemplateProps): Theme.TemplateProps => p;
const _page = (p: Page): Theme.Page => p;
const _index = (p: PageIndex): Theme.PageIndex => p;
const _translation = (p: PageTranslation): Theme.PageTranslation => p;
const _collection = (c: Collection): Theme.Collection => c;
const _frontmatter = (
  f: import("../../src/content/types.ts").PageFrontmatter,
): Theme.PageFrontmatter => f;
const _config = (c: TemplateProps["config"]): Theme.TemplateConfig => c;
const _site = (s: TemplateProps["site"]): Theme.SiteConfig => s;
const _component = (c: TemplateComponent): Theme.TemplateComponent => c;

// --- package -> core: what a theme hands in -------------------------------

const _themeTemplate: TemplateComponent = (props: Theme.TemplateProps) =>
  props.page.frontmatter.title;
const _themeTemplateWithExtras: TemplateComponent = (
  props: Theme.TemplateProps & { landing?: boolean },
) => props.landing;

void [
  _props,
  _page,
  _index,
  _translation,
  _collection,
  _frontmatter,
  _config,
  _site,
  _component,
  _themeTemplate,
  _themeTemplateWithExtras,
];
