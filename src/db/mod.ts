/**
 * DB Schema Layer — public module exports.
 *
 * Import as: import { ... } from "@dune/core/db";
 */

/** @module */

export type {
  ApiMethod,
  DbAdapter,
  DbFieldDef,
  DbFieldType,
  DbSchema,
  DbSchemaApi,
  FieldOperators,
  FindOptions,
  Repository,
  WhereClause,
} from "./types.ts";

export { createDbAdapter, KVAdapter, PostgresAdapter, SQLiteAdapter } from "./adapters/mod.ts";
export { createRepository, createRepositoryFromSchema } from "./repository.ts";
export { loadSchemas, modelToTableName, parseRawSchema, parseSchemaYaml } from "./schema-parser.ts";
export { generateApiRoutes, generateCode, writeGeneratedFiles } from "./codegen.ts";
export {
  generateCreateTableSql,
  generateMigrations,
  migrationStatus,
  runMigrations,
} from "./migrate.ts";
export type { MigrationStatus } from "./migrate.ts";
export type { CodegenResult } from "./codegen.ts";
