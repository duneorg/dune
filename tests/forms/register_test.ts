import { assertEquals } from "@std/assert";
import { registerFormRoutes } from "../../src/forms/register.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";
import type { BootstrapResult } from "../../src/runtime/bootstrap.ts";

function stubApp() {
  const routes: string[] = [];
  const add = (method: string) => (path: string) => void routes.push(`${method} ${path}`);
  // deno-lint-ignore no-explicit-any
  return { routes, app: { get: add("GET"), post: add("POST") } as any };
}

const ctx = {
  config: structuredClone(DEFAULT_CONFIG),
  storage: new MemoryStorageAdapter(),
  submissions: {},
  hooks: {},
  engine: {},
  imageCache: {},
} as unknown as BootstrapResult;

Deno.test("registerFormRoutes: registers the three public routes", () => {
  const { app, routes } = stubApp();
  registerFormRoutes(app, ctx);
  assertEquals(routes.sort(), [
    "GET /api/forms/:name",
    "POST /api/forms/:name",
    "POST /api/webhook/incoming",
  ]);
});

Deno.test("registerFormRoutes: a second call for the same app registers nothing", () => {
  const { app, routes } = stubApp();
  registerFormRoutes(app, ctx);
  registerFormRoutes(app, ctx);
  assertEquals(routes.length, 3);
});
