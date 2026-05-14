import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateCode } from "../../src/db/codegen.ts";
import { parseSchemaYaml } from "../../src/db/schema-parser.ts";

const COMMENT_SCHEMA_YAML = `
model: Comment
table: comments
fields:
  pageRoute:
    type: string
    required: true
    maxLength: 1024
    index: true
  author:
    type: string
    required: true
    maxLength: 256
  body:
    type: text
    required: true
  status:
    type: string
    enum: [pending, approved, rejected]
    default: pending
    index: true
  createdAt:
    type: datetime
    default: now
  updatedAt:
    type: datetime
    default: now
    onUpdate: now
`;

Deno.test("codegen: generates comment model interface", () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { files } = generateCode([schema]);

  const modelFile = files.get("src/db/types/comment.ts");
  if (!modelFile) throw new Error("Expected src/db/types/comment.ts to be generated");

  // Header comment
  assertStringIncludes(modelFile, "GENERATED");
  assertStringIncludes(modelFile, "dune codegen");

  // Interface
  assertStringIncludes(modelFile, "export interface Comment");
  assertStringIncludes(modelFile, "id: string;");
  assertStringIncludes(modelFile, "pageRoute: string;");
  assertStringIncludes(modelFile, "author: string;");
  assertStringIncludes(modelFile, "body: string;");
  assertStringIncludes(modelFile, `status: "pending" | "approved" | "rejected";`);
  assertStringIncludes(modelFile, "createdAt: Date;");
  assertStringIncludes(modelFile, "updatedAt: Date;");

  // CommentCreate omits id, createdAt, updatedAt
  assertStringIncludes(modelFile, "export type CommentCreate");
  assertStringIncludes(modelFile, `Omit<Comment`);
  assertStringIncludes(modelFile, `"id"`);
  assertStringIncludes(modelFile, `"createdAt"`);
  assertStringIncludes(modelFile, `"updatedAt"`);

  // CommentUpdate
  assertStringIncludes(modelFile, "export type CommentUpdate = Partial<CommentCreate>;");
});

Deno.test("codegen: generates db/index.ts", () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { files } = generateCode([schema]);

  const indexFile = files.get("src/db/index.ts");
  if (!indexFile) throw new Error("Expected src/db/index.ts to be generated");

  assertStringIncludes(indexFile, "GENERATED");
  assertStringIncludes(indexFile, `import { createDbAdapter } from "@dune/core/db"`);
  assertStringIncludes(indexFile, `import { createRepository } from "@dune/core/db"`);
  assertStringIncludes(indexFile, "const adapter = await createDbAdapter();");
  assertStringIncludes(indexFile, "export const db =");
  assertStringIncludes(indexFile, `comments:`);
  assertStringIncludes(indexFile, `createRepository<Comment, CommentCreate, CommentUpdate>`);
  assertStringIncludes(indexFile, `"comments"`);
  assertStringIncludes(indexFile, "export type { Comment, CommentCreate, CommentUpdate };");
});

Deno.test("codegen: generates files for multiple schemas", () => {
  const schemaA = parseSchemaYaml(`
model: Post
fields:
  title:
    type: string
    required: true
  publishedAt:
    type: datetime
    default: now
`);
  const schemaB = parseSchemaYaml(`
model: Tag
fields:
  name:
    type: string
    required: true
`);
  const { files } = generateCode([schemaA, schemaB]);

  assertEquals(files.size, 3); // post.ts, tag.ts, index.ts
  assertEquals(files.has("src/db/types/post.ts"), true);
  assertEquals(files.has("src/db/types/tag.ts"), true);
  assertEquals(files.has("src/db/index.ts"), true);

  const indexFile = files.get("src/db/index.ts")!;
  assertStringIncludes(indexFile, "Post, PostCreate, PostUpdate");
  assertStringIncludes(indexFile, "Tag, TagCreate, TagUpdate");
});

Deno.test("codegen: boolean field typed correctly", () => {
  const schema = parseSchemaYaml(`
model: Feature
fields:
  enabled:
    type: boolean
    required: true
`);
  const { files } = generateCode([schema]);
  const modelFile = files.get("src/db/types/feature.ts")!;
  assertStringIncludes(modelFile, "enabled: boolean;");
});

Deno.test("codegen: integer and number fields typed correctly", () => {
  const schema = parseSchemaYaml(`
model: Stats
fields:
  views:
    type: integer
  score:
    type: number
`);
  const { files } = generateCode([schema]);
  const modelFile = files.get("src/db/types/stats.ts")!;
  assertStringIncludes(modelFile, "views?: number;");
  assertStringIncludes(modelFile, "score?: number;");
});

Deno.test("codegen: json field typed as unknown", () => {
  const schema = parseSchemaYaml(`
model: Config
fields:
  data:
    type: json
`);
  const { files } = generateCode([schema]);
  const modelFile = files.get("src/db/types/config.ts")!;
  assertStringIncludes(modelFile, "data?: unknown;");
});
