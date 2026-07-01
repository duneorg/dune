/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { TemplateComponent } from "../content/types.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { FlexRecord, FlexSchema } from "../flex/types.ts";

/**
 * Props passed to a flex type list template.
 * Convention: `themes/{theme}/templates/flex/{type}-list.tsx`
 * Fallback:   `themes/{theme}/templates/flex/list.tsx`
 */
export interface FlexListTemplateProps {
  type: string;
  schema: FlexSchema;
  records: FlexRecord[];
  site: DuneEngine["site"];
  config: DuneEngine["config"];
  nav: ReturnType<DuneEngine["router"]["getTopNavigation"]>;
  pathname: string;
  Layout?: TemplateComponent;
  t: (key: string) => string;
}

/**
 * Props passed to a flex record detail template.
 * Convention: `themes/{theme}/templates/flex/{type}.tsx`
 * Fallback:   `themes/{theme}/templates/flex/detail.tsx`
 */
export interface FlexDetailTemplateProps {
  type: string;
  schema: FlexSchema;
  record: FlexRecord;
  site: DuneEngine["site"];
  config: DuneEngine["config"];
  nav: ReturnType<DuneEngine["router"]["getTopNavigation"]>;
  pathname: string;
  Layout?: TemplateComponent;
  t: (key: string) => string;
}

/**
 * Handle public flex object routes: /flex/{type} (list) and /flex/{type}/{id} (detail).
 * Called only when `url.pathname.startsWith("/flex/")` and `flex` is available.
 */
export async function handleFlexRoute(
  engine: DuneEngine,
  url: URL,
  flex: FlexEngine,
  render: (jsx: unknown, status?: number) => Response | Promise<Response>,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["flex", type, ...id]
  if (parts.length < 2) {
    return render(h("div", null, "Flex type not specified"), 404);
  }

  const flexType = decodeURIComponent(parts[1]);
  const schemas = await flex.loadSchemas();
  const schema = schemas[flexType];
  if (!schema) {
    return render(h("div", null, `Flex type "${flexType}" not found`), 404);
  }

  const strings = await engine.themes.loadLocale("en");
  const t = (key: string) => (strings[key] ?? key) as string;
  const layout = await engine.themes.loadLayout("layout");
  const nav = engine.router.getTopNavigation("en");
  const baseProps = {
    type: flexType,
    schema,
    site: engine.site,
    config: engine.config,
    nav,
    pathname: url.pathname,
    Layout: layout ?? undefined,
    t,
  };

  if (parts.length === 2) {
    return handleFlexList(engine, url, flex, flexType, schema, baseProps, render);
  }

  if (parts.length === 3) {
    return handleFlexDetail(engine, url, flex, flexType, schema, baseProps, render);
  }

  return render(h("div", null, "Not found"), 404);
}

async function handleFlexList(
  engine: DuneEngine,
  _url: URL,
  flex: FlexEngine,
  flexType: string,
  schema: FlexSchema,
  baseProps: Omit<FlexListTemplateProps, "records">,
  render: (jsx: unknown, status?: number) => Response | Promise<Response>,
): Promise<Response> {
  const records = await flex.list(flexType);
  const templateNames = [`flex/${flexType}-list`, "flex/list"];
  let template = null;
  for (const name of templateNames) {
    template = await engine.themes.loadTemplate(name);
    if (template) break;
  }

  if (!template) {
    return render(
      h("html", null,
        h("head", null,
          h("title", null, schema.title),
          h("meta", { charset: "utf-8" }),
          h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          h("style", null, "body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left}th{background:#f5f5f5}a{color:#0066cc}"),
        ),
        h("body", null,
          h("h1", null, `${schema.icon ?? ""} ${schema.title}`),
          schema.description ? h("p", null, schema.description) : null,
          records.length === 0
            ? h("p", null, "No records yet.")
            : h("table", null,
                h("thead", null,
                  h("tr", null, ...Object.keys(schema.fields).slice(0, 4).map((f) =>
                    h("th", { key: f }, schema.fields[f].label ?? f)
                  )),
                ),
                h("tbody", null, ...records.map((r) =>
                  h("tr", { key: r._id },
                    ...Object.keys(schema.fields).slice(0, 4).map((f) =>
                      h("td", { key: f },
                        h("a", { href: `/flex/${flexType}/${r._id}` },
                          f === Object.keys(schema.fields)[0]
                            ? String(r[f] ?? r._id)
                            : String(r[f] ?? "")
                        )
                      )
                    )
                  )
                )),
              ),
        ),
      ),
    );
  }

  return render(
    h(template.component as unknown as ComponentType<FlexListTemplateProps>, {
      ...baseProps,
      records,
    }),
  );
}

async function handleFlexDetail(
  engine: DuneEngine,
  url: URL,
  flex: FlexEngine,
  flexType: string,
  schema: FlexSchema,
  baseProps: Omit<FlexDetailTemplateProps, "record">,
  render: (jsx: unknown, status?: number) => Response | Promise<Response>,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  const recordId = decodeURIComponent(parts[2]);
  const record = await flex.get(flexType, recordId);
  if (!record) {
    return render(h("div", null, `Record "${recordId}" not found`), 404);
  }

  const templateNames = [`flex/${flexType}`, "flex/detail"];
  let template = null;
  for (const name of templateNames) {
    template = await engine.themes.loadTemplate(name);
    if (template) break;
  }

  if (!template) {
    const title = String((record.name ?? record.title ?? record._id) as string);
    return render(
      h("html", null,
        h("head", null,
          h("title", null, `${title} — ${schema.title}`),
          h("meta", { charset: "utf-8" }),
          h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          h("style", null, "body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}dl{display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem}dt{font-weight:600;color:#555}dd{margin:0}a{color:#0066cc}"),
        ),
        h("body", null,
          h("p", null, h("a", { href: `/flex/${flexType}` }, `← All ${schema.title}`)),
          h("h1", null, title),
          h("dl", null,
            ...Object.entries(record)
              .filter(([k]) => !k.startsWith("_"))
              .flatMap(([k, v]) => [
                h("dt", { key: `dt-${k}` }, schema.fields[k]?.label ?? k),
                h("dd", { key: `dd-${k}` }, String(Array.isArray(v) ? v.join(", ") : v ?? "")),
              ])
          ),
        ),
      ),
    );
  }

  return render(
    h(template.component as unknown as ComponentType<FlexDetailTemplateProps>, {
      ...baseProps,
      record,
    }),
  );
}
