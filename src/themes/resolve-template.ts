/** @jsxImportSource preact */
/**
 * Async template support.
 *
 * Fresh's `ctx.render` (and `preact-render-to-string`) render synchronously:
 * a component that returns a Promise silently renders as nothing. Theme
 * templates are allowed to be `async function` components (e.g. to call
 * `await page.html()`), so before handing a template to the renderer we
 * invoke it ourselves and await the result.
 *
 * Only the top-level template component may be async — async function
 * components cannot use hooks, which is what makes the direct invocation
 * safe. Nested components (including the `Layout` a template renders) must
 * stay synchronous.
 */
import { h, type ComponentType, type VNode } from "preact";

const AsyncFunction = (async () => {}).constructor;

/**
 * Build the vnode for a top-level template component, awaiting the
 * component first when it is declared `async`. Sync components are wrapped
 * in a normal vnode and pay no extra cost.
 */
// deno-lint-ignore no-explicit-any
export async function resolveTemplateVNode<P = any>(
  component: ComponentType<P>,
  props: P & Record<string, unknown>,
): Promise<VNode | unknown> {
  if (component instanceof AsyncFunction) {
    return await (component as unknown as (p: P) => Promise<unknown>)(props);
  }
  // deno-lint-ignore no-explicit-any
  return h(component as ComponentType<any>, props);
}
