/**
 * DB Schema Layer — core type definitions.
 *
 * This file must not import anything from Dune internals.
 */

/** @module */

// ---------------------------------------------------------------------------
// Where clause DSL
// ---------------------------------------------------------------------------

export type FieldOperators<V> = {
  $gt?: V;
  $lt?: V;
  $gte?: V;
  $lte?: V;
  $in?: V[];
  $notIn?: V[];
  $contains?: string;
  $startsWith?: string;
  $isNull?: boolean;
};

export type WhereClause<T> = {
  [K in keyof T]?: T[K] | FieldOperators<T[K]>;
} & { $or?: WhereClause<T>[] };

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface FindOptions<T> {
  where?: WhereClause<T>;
  orderBy?: keyof T | [keyof T, "asc" | "desc"];
  limit?: number;
  offset?: number;
}

export interface Repository<T, TCreate, TUpdate> {
  /** Return all rows matching options. */
  find(opts?: FindOptions<T>): Promise<T[]>;

  /**
   * Return exactly one row matching `where`.
   * Returns `null` if no row found.
   * Throws `Error` if `where` matches more than one row.
   */
  findOne(opts: { where: WhereClause<T> }): Promise<T | null>;

  /** Insert a new row and return the inserted record (with generated id). */
  create(data: TCreate): Promise<T>;

  /** Update the row with the given id. Returns `{ count }` rows affected. */
  update(id: string, data: TUpdate): Promise<{ count: number }>;

  /** Delete the row with the given id. Returns `{ count }` rows affected. */
  delete(id: string): Promise<{ count: number }>;

  /** Count rows matching an optional where clause. */
  count(opts?: { where?: WhereClause<T> }): Promise<number>;

  /**
   * Atomically insert or replace based on `where`.
   * If a matching row exists it is replaced; otherwise a new row is inserted.
   */
  upsert(where: WhereClause<T>, data: TCreate): Promise<T>;

  /** Return the underlying DbAdapter for raw escape-hatch queries. */
  getAdapter(): DbAdapter;
}

// ---------------------------------------------------------------------------
// DbAdapter interface
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<R[]>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal schema representation (output of schema-parser.ts)
// ---------------------------------------------------------------------------

export type DbFieldType =
  | "string"
  | "text"
  | "integer"
  | "number"
  | "boolean"
  | "datetime"
  | "json";

export interface DbFieldDef {
  name: string;
  type: DbFieldType;
  required?: boolean;
  maxLength?: number;
  index?: boolean;
  enum?: string[];
  default?: unknown;
  onUpdate?: "now";
}

/** Valid HTTP method names for CRUD API generation. */
export type ApiMethod = "get" | "list" | "create" | "update" | "delete";

/** API generation options embedded in a schema YAML `api:` block. */
export interface DbSchemaApi {
  /** Whether to generate REST endpoints for this model. */
  enabled: boolean;
  /**
   * Authentication mode:
   * - "none"     — public; no authentication required
   * - "required" — any authenticated site user
   * - "owner"    — record's ownerField must match the authenticated user's id
   */
  auth: "none" | "required" | "owner";
  /** Which HTTP operations to expose. Defaults to all five. */
  methods: ApiMethod[];
  /**
   * Field name that stores the owner's user id.
   * Required when auth is "owner".
   */
  ownerField?: string;
}

export interface DbSchema {
  /** TypeScript model name (e.g. "Comment"). */
  model: string;
  /** SQL table name (e.g. "comments"). */
  table: string;
  /** Ordered list of field definitions (id is never in this list). */
  fields: DbFieldDef[];
  /** Optional REST API generation configuration. */
  api?: DbSchemaApi;
}
