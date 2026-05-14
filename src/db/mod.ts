/**
 * DB Schema Layer — public module exports.
 *
 * Import as: import { ... } from "@dune/core/db";
 */

/** @module */

export type {
  DbAdapter,
  DbFieldDef,
  DbFieldType,
  DbSchema,
  FieldOperators,
  FindOptions,
  Repository,
  WhereClause,
} from "./types.ts";

export { createDbAdapter, SQLiteAdapter, KVAdapter, PostgresAdapter } from "./adapters/mod.ts";
export { createRepository, createRepositoryFromSchema } from "./repository.ts";
export { loadSchemas, parseSchemaYaml, parseRawSchema, modelToTableName } from "./schema-parser.ts";
export { generateCode, writeGeneratedFiles } from "./codegen.ts";
export {
  generateCreateTableSql,
  generateMigrations,
  runMigrations,
  migrationStatus,
} from "./migrate.ts";
export type { MigrationStatus } from "./migrate.ts";
export type { CodegenResult } from "./codegen.ts";
