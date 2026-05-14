/**
 * Tests for CRUD API codegen — schema api: block parsing, route generation,
 * and the requireAuth guard helper.
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseRawSchema, parseSchemaYaml } from "../../src/db/schema-parser.ts";
import { generateApiRoutes } from "../../src/db/codegen.ts";
import { requireAuth, SITE_USER_HEADER } from "../../src/auth/api-guard.ts";
import type { SiteUser } from "../../src/auth/types.ts";

// ---------------------------------------------------------------------------
// Schema parsing — api: block
// ---------------------------------------------------------------------------

const BASE_FIELDS = {
  body: { type: "text", required: true },
  userId: { type: "string", required: true },
};

Deno.test("parseRawSchema: parses api block with all fields", () => {
  const schema = parseRawSchema({
    model: "Comment",
    table: "comments",
    fields: BASE_FIELDS,
    api: {
      enabled: true,
      auth: "required",
      methods: ["get", "list", "create", "update", "delete"],
    },
  });

  assertEquals(schema.api?.enabled, true);
  assertEquals(schema.api?.auth, "required");
  assertEquals(schema.api?.methods, ["get", "list", "create", "update", "delete"]);
  assertEquals(schema.api?.ownerField, undefined);
});

Deno.test("parseRawSchema: parses api block with owner auth", () => {
  const schema = parseRawSchema({
    model: "Comment",
    table: "comments",
    fields: BASE_FIELDS,
    api: {
      enabled: true,
      auth: "owner",
      methods: ["get", "update", "delete"],
      ownerField: "userId",
    },
  });

  assertEquals(schema.api?.auth, "owner");
  assertEquals(schema.api?.ownerField, "userId");
  assertEquals(schema.api?.methods, ["get", "update", "delete"]);
});

Deno.test("parseRawSchema: parses api block with auth:none", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: { title: { type: "string", required: true } },
    api: {
      enabled: false,
      auth: "none",
      methods: ["list", "get"],
    },
  });

  assertEquals(schema.api?.enabled, false);
  assertEquals(schema.api?.auth, "none");
});

Deno.test("parseRawSchema: defaults methods to all five when omitted", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: { title: { type: "string", required: true } },
    api: { enabled: true, auth: "required" },
  });

  assertEquals(schema.api?.methods.sort(), ["create", "delete", "get", "list", "update"]);
});

Deno.test("parseRawSchema: schema without api block has no api property", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: { title: { type: "string", required: true } },
  });
  assertEquals(schema.api, undefined);
});

Deno.test("parseRawSchema: parses api block from YAML", () => {
  const schema = parseSchemaYaml(`
model: Comment
table: comments
fields:
  body:
    type: text
    required: true
  userId:
    type: string
    required: true
api:
  enabled: true
  auth: owner
  methods: [get, list, create, update, delete]
  ownerField: userId
`);
  assertEquals(schema.api?.auth, "owner");
  assertEquals(schema.api?.ownerField, "userId");
});

// ---------------------------------------------------------------------------
// Schema parsing — api: block validation errors
// ---------------------------------------------------------------------------

Deno.test("parseRawSchema: rejects invalid auth value", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, auth: "admin", methods: ["get"] },
      }),
    Error,
    "api.auth must be one of",
  );
});

Deno.test("parseRawSchema: rejects missing auth", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, methods: ["get"] },
      }),
    Error,
    "auth",
  );
});

Deno.test("parseRawSchema: rejects auth:owner without ownerField", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, auth: "owner", methods: ["get"] },
      }),
    Error,
    "ownerField is required",
  );
});

Deno.test("parseRawSchema: rejects ownerField that is not a schema field", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, auth: "owner", methods: ["get"], ownerField: "nonexistent" },
      }),
    Error,
    "nonexistent",
  );
});

Deno.test("parseRawSchema: rejects invalid method name", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, auth: "required", methods: ["get", "patch"] },
      }),
    Error,
    "patch",
  );
});

Deno.test("parseRawSchema: rejects empty methods array", () => {
  assertThrows(
    () =>
      parseRawSchema({
        model: "Comment",
        fields: BASE_FIELDS,
        api: { enabled: true, auth: "required", methods: [] },
      }),
    Error,
    "must not be empty",
  );
});

// ---------------------------------------------------------------------------
// generateApiRoutes — output content checks (uses temp dir)
// ---------------------------------------------------------------------------

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "dune_api_codegen_test_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("generateApiRoutes: writes index.ts and [id].ts for enabled schema", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "Comment",
      table: "comments",
      fields: BASE_FIELDS,
      api: {
        enabled: true,
        auth: "required",
        methods: ["get", "list", "create", "update", "delete"],
      },
    });

    const written = await generateApiRoutes([schema], dir);
    assertEquals(written.length, 2);

    const indexContent = await Deno.readTextFile(`${dir}/src/routes/api/comments/index.ts`);
    const idContent = await Deno.readTextFile(`${dir}/src/routes/api/comments/[id].ts`);

    // index.ts — list and create handlers
    assertStringIncludes(indexContent, "GENERATED");
    assertStringIncludes(indexContent, `export async function GET`);
    assertStringIncludes(indexContent, `export async function POST`);
    assertStringIncludes(indexContent, `requireAuth`);
    assertStringIncludes(indexContent, `"required"`);
    assertStringIncludes(indexContent, `db.comments.find`);
    assertStringIncludes(indexContent, `db.comments.count`);
    assertStringIncludes(indexContent, `db.comments.create`);
    assertStringIncludes(indexContent, `CommentCreate`);
    assertStringIncludes(indexContent, `jsr:@dune/core/auth/api-guard`);

    // [id].ts — get, update, delete handlers
    assertStringIncludes(idContent, "GENERATED");
    assertStringIncludes(idContent, `export async function GET`);
    assertStringIncludes(idContent, `export async function PUT`);
    assertStringIncludes(idContent, `export async function DELETE`);
    assertStringIncludes(idContent, `db.comments.findOne`);
    assertStringIncludes(idContent, `db.comments.update`);
    assertStringIncludes(idContent, `db.comments.delete`);
    assertStringIncludes(idContent, `CommentUpdate`);
  });
});

Deno.test("generateApiRoutes: owner mode includes ownership checks in [id].ts", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "Comment",
      table: "comments",
      fields: BASE_FIELDS,
      api: {
        enabled: true,
        auth: "owner",
        methods: ["get", "update", "delete"],
        ownerField: "userId",
      },
    });

    await generateApiRoutes([schema], dir);
    const idContent = await Deno.readTextFile(`${dir}/src/routes/api/comments/[id].ts`);

    assertStringIncludes(idContent, `"owner"`);
    assertStringIncludes(idContent, `.userId`);
    assertStringIncludes(idContent, `Forbidden`);
    assertStringIncludes(idContent, `authResult.user!.id`);
  });
});

Deno.test("generateApiRoutes: respects partial methods — only list and create", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "Post",
      table: "posts",
      fields: { title: { type: "string", required: true } },
      api: {
        enabled: true,
        auth: "none",
        methods: ["list", "create"],
      },
    });

    const written = await generateApiRoutes([schema], dir);
    // Only index.ts, no [id].ts
    assertEquals(written.length, 1);
    assertStringIncludes(written[0], "index.ts");

    const indexContent = await Deno.readTextFile(`${dir}/src/routes/api/posts/index.ts`);
    assertStringIncludes(indexContent, `export async function GET`);
    assertStringIncludes(indexContent, `export async function POST`);
    assertStringIncludes(indexContent, `"none"`);
  });
});

Deno.test("generateApiRoutes: skips schemas with api.enabled: false", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "Hidden",
      table: "hiddens",
      fields: { name: { type: "string" } },
      api: { enabled: false, auth: "required", methods: ["list"] },
    });

    const written = await generateApiRoutes([schema], dir);
    assertEquals(written.length, 0);
  });
});

Deno.test("generateApiRoutes: skips schemas without api block", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "NoApi",
      table: "no_apis",
      fields: { name: { type: "string" } },
    });

    const written = await generateApiRoutes([schema], dir);
    assertEquals(written.length, 0);
  });
});

Deno.test("generateApiRoutes: only [id].ts when methods are get/update/delete", async () => {
  await withTempDir(async (dir) => {
    const schema = parseRawSchema({
      model: "Comment",
      table: "comments",
      fields: BASE_FIELDS,
      api: {
        enabled: true,
        auth: "required",
        methods: ["get", "update", "delete"],
      },
    });

    const written = await generateApiRoutes([schema], dir);
    assertEquals(written.length, 1);
    assertStringIncludes(written[0], "[id].ts");
  });
});

// ---------------------------------------------------------------------------
// requireAuth — guard helper
// ---------------------------------------------------------------------------

function makeRequest(user: SiteUser | null): Request {
  const headers: Record<string, string> = {};
  if (user) {
    headers[SITE_USER_HEADER] = JSON.stringify(user);
  }
  return new Request("https://example.com/api/comments", { headers });
}

const MOCK_USER: SiteUser = {
  id: "user-123",
  email: "alice@example.com",
  provider: "local",
  roles: [],
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
  enabled: true,
};

Deno.test("requireAuth: mode 'none' always passes — with user", async () => {
  const req = makeRequest(MOCK_USER);
  const result = await requireAuth(req, "none");
  assertEquals(result.error, null);
  assertEquals((result as any).user?.id, "user-123");
});

Deno.test("requireAuth: mode 'none' always passes — without user", async () => {
  const req = makeRequest(null);
  const result = await requireAuth(req, "none");
  assertEquals(result.error, null);
  assertEquals((result as any).user, null);
});

Deno.test("requireAuth: mode 'required' passes when user present", async () => {
  const req = makeRequest(MOCK_USER);
  const result = await requireAuth(req, "required");
  assertEquals(result.error, null);
  assertEquals((result as any).user?.id, "user-123");
});

Deno.test("requireAuth: mode 'required' returns 401 when no user", async () => {
  const req = makeRequest(null);
  const result = await requireAuth(req, "required");
  assertEquals(result.error instanceof Response, true);
  assertEquals((result.error as Response).status, 401);
  assertEquals((result as any).user, null);
});

Deno.test("requireAuth: mode 'owner' returns 401 when no user", async () => {
  const req = makeRequest(null);
  const result = await requireAuth(req, "owner");
  assertEquals(result.error instanceof Response, true);
  assertEquals((result.error as Response).status, 401);
});

Deno.test("requireAuth: mode 'owner' passes when user present", async () => {
  const req = makeRequest(MOCK_USER);
  const result = await requireAuth(req, "owner");
  assertEquals(result.error, null);
  assertEquals((result as any).user?.id, "user-123");
});

Deno.test("requireAuth: malformed header treated as no user", async () => {
  const req = new Request("https://example.com/", {
    headers: { [SITE_USER_HEADER]: "not-valid-json{{" },
  });
  const result = await requireAuth(req, "required");
  assertEquals(result.error instanceof Response, true);
  assertEquals((result.error as Response).status, 401);
});
