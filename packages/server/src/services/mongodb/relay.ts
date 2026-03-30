import type { MongoDBCredentials } from "@onequery/db/server";

const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 20_000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_QUERY_MAX_TIME_MS = 20_000;
const MAX_DATABASE_NAME_LENGTH = 63;
const MAX_COLLECTION_NAME_LENGTH = 255;
const BLOCKED_MONGO_OPERATOR_NAMES = new Set([
  "$accumulator",
  "$function",
  "$where",
]);

type MongoDbDocument = Record<string, unknown>;

interface MongoDbListDatabasesResponse {
  databases: {
    name: string;
    sizeOnDisk?: number;
    empty?: boolean;
  }[];
}

interface MongoDbListCollectionsRequest {
  database?: string;
}

interface MongoDbListCollectionsResponse {
  database: string;
  collections: {
    name: string;
    type?: string;
  }[];
}

interface MongoDbFindDocumentsRequest {
  database?: string;
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  maxTimeMs?: number;
}

interface MongoDbFindDocumentsResponse {
  database: string;
  collection: string;
  count: number;
  documents: MongoDbDocument[];
}

interface MongoDbDatabaseAccess {
  allowedDatabases: string[];
  defaultDatabase: string | null;
}

type RelayMongoClient = {
  connect(): Promise<unknown>;
  close(): Promise<void>;
  db(name?: string): {
    admin(): {
      listDatabases(): Promise<{
        databases?: {
          name?: string;
          sizeOnDisk?: number;
          empty?: boolean;
        }[];
      }>;
    };
    listCollections(
      filter?: Record<string, unknown>,
      options?: Record<string, unknown>
    ): {
      toArray(): Promise<{ name?: string; type?: string }[]>;
    };
    collection(name: string): {
      find(
        filter: Record<string, unknown>,
        options?: Record<string, unknown>
      ): {
        toArray(): Promise<unknown[]>;
      };
    };
  };
};

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function normalizeMongoConnectionString(connectionString: string): string {
  const normalized = connectionString.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error("MongoDB connection string is required");
  }
  return normalized;
}

function normalizeMongoDatabaseName(
  value: string | undefined,
  field: string
): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  if (
    normalized.length > MAX_DATABASE_NAME_LENGTH ||
    hasControlCharacters(normalized) ||
    /[/\\."$*<>:|?]/u.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizeMongoCollectionName(collection: string): string {
  const normalized = collection.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_COLLECTION_NAME_LENGTH ||
    hasControlCharacters(normalized) ||
    normalized.includes("\u0000")
  ) {
    throw new Error("collection is invalid");
  }
  if (normalized.startsWith("$")) {
    throw new Error("collection is invalid");
  }
  return normalized;
}

function validateMongoQueryValue(value: unknown, path: string): void {
  if (value === null || value === undefined) {
    return;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateMongoQueryValue(entry, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains an unsupported value`);
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (hasControlCharacters(key)) {
      throw new Error(`${path} contains an invalid key`);
    }
    if (BLOCKED_MONGO_OPERATOR_NAMES.has(key)) {
      throw new Error(`${path} contains unsupported operator ${key}`);
    }
    validateMongoQueryValue(nestedValue, `${path}.${key}`);
  }
}

function extractDatabaseFromMongoUri(connectionString: string): string | null {
  const normalizedConnectionString =
    normalizeMongoConnectionString(connectionString);
  if (typeof URL.canParse !== "function") {
    return null;
  }
  if (!URL.canParse(normalizedConnectionString)) {
    return null;
  }
  const url = new URL(normalizedConnectionString);
  const pathname = url.pathname ? url.pathname.replace(/^\//, "") : "";
  const decoded = decodeURIComponent(pathname).trim();
  if (decoded.length === 0) {
    return null;
  }
  return decoded;
}

function normalizeMongoDatabaseNames(databases?: string[]): string[] {
  if (!databases) {
    return [];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of databases) {
    const dbName = normalizeMongoDatabaseName(value, "database");
    if (!dbName) {
      continue;
    }
    const key = dbName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(dbName);
  }
  return normalized;
}

function resolveMongoDatabaseAccess(
  credentials: MongoDBCredentials
): MongoDbDatabaseAccess {
  const normalizedAllowed = normalizeMongoDatabaseNames(credentials.databases);
  const configuredDefault = normalizeMongoDatabaseName(
    credentials.database,
    "database"
  );
  const uriDatabase = extractDatabaseFromMongoUri(credentials.connectionString);
  const defaultDatabase = configuredDefault ?? uriDatabase;

  if (normalizedAllowed.length > 0) {
    return { allowedDatabases: normalizedAllowed, defaultDatabase };
  }

  if (defaultDatabase) {
    return {
      allowedDatabases: [defaultDatabase],
      defaultDatabase,
    };
  }

  // Comment: When no database or allowlist is configured, this relay still
  // permits broad database discovery because tightening it would change saved
  // MongoDB data source behavior outside this scoped pass.
  return {
    allowedDatabases: [],
    defaultDatabase: null,
  };
}

function ensureMongoDatabaseAllowed(input: {
  database: string;
  allowedDatabases: string[];
}): void {
  if (input.allowedDatabases.length === 0) {
    return;
  }
  const databaseKey = input.database.toLowerCase();
  const isAllowed = input.allowedDatabases.some(
    (value) => value.toLowerCase() === databaseKey
  );
  if (!isAllowed) {
    throw new Error(
      `Database "${input.database}" is not allowed by this data source configuration`
    );
  }
}

function resolveMongoDatabaseName(input: {
  requestedDatabase?: string;
  access: MongoDbDatabaseAccess;
}): string {
  const requested = normalizeMongoDatabaseName(
    input.requestedDatabase,
    "database"
  );
  const resolved =
    requested ??
    input.access.defaultDatabase ??
    input.access.allowedDatabases[0];
  if (!resolved) {
    throw new Error(
      "Database is required in request or MongoDB data source configuration"
    );
  }
  ensureMongoDatabaseAllowed({
    allowedDatabases: input.access.allowedDatabases,
    database: resolved,
  });
  return resolved;
}

function sanitizeMongoErrorMessage(message: string): string {
  return message
    .replaceAll(
      /mongodb(\+srv)?:\/\/([^@\s]+)@/gi,
      (_value, scheme: string) => `mongodb${scheme ?? ""}://***@`
    )
    .replaceAll(/password[=:]\s*[^,\s]+/gi, "password=***");
}

function normalizePositiveInt(
  value: number | undefined,
  input: { defaultValue: number; min: number; max: number; field: string }
): number {
  if (value === undefined) {
    return input.defaultValue;
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(`${input.field} must be an integer`);
  }
  if (value < input.min || value > input.max) {
    throw new Error(
      `${input.field} must be between ${input.min} and ${input.max}`
    );
  }
  return value;
}

function serializeMongoDocuments(documents: unknown[]): MongoDbDocument[] {
  const serialized = JSON.parse(JSON.stringify(documents)) as unknown;
  if (!Array.isArray(serialized)) {
    return [];
  }
  return serialized.filter(
    (value): value is MongoDbDocument =>
      typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

async function withMongoClient<T>(
  credentials: MongoDBCredentials,
  run: (client: RelayMongoClient) => Promise<T>
): Promise<T> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(
    normalizeMongoConnectionString(credentials.connectionString),
    {
      appName: "onequery-server-relay",
      serverSelectionTimeoutMS: DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    }
  ) as RelayMongoClient;
  try {
    await client.connect();
    return await run(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(sanitizeMongoErrorMessage(message), { cause: error });
  } finally {
    await client.close().catch(() => null);
  }
}

export async function listMongoDatabases(input: {
  credentials: MongoDBCredentials;
}): Promise<MongoDbListDatabasesResponse> {
  const access = resolveMongoDatabaseAccess(input.credentials);
  return withMongoClient(input.credentials, async (client) => {
    const result = await client.db("admin").admin().listDatabases();
    const databases = (result.databases ?? [])
      .filter(
        (
          value
        ): value is { name: string; sizeOnDisk?: number; empty?: boolean } =>
          typeof value.name === "string" && value.name.trim().length > 0
      )
      .filter((value) => {
        if (access.allowedDatabases.length === 0) {
          return true;
        }
        return access.allowedDatabases.some(
          (allowed) => allowed.toLowerCase() === value.name.toLowerCase()
        );
      })
      .map((value) => ({
        empty: value.empty,
        name: value.name,
        sizeOnDisk: value.sizeOnDisk,
      }));
    return { databases };
  });
}

export async function listMongoCollections(input: {
  credentials: MongoDBCredentials;
  request: MongoDbListCollectionsRequest;
}): Promise<MongoDbListCollectionsResponse> {
  const access = resolveMongoDatabaseAccess(input.credentials);
  const database = resolveMongoDatabaseName({
    access,
    requestedDatabase: input.request.database,
  });
  return withMongoClient(input.credentials, async (client) => {
    const collections = await client
      .db(database)
      .listCollections({}, { nameOnly: false })
      .toArray();
    return {
      collections: collections
        .filter(
          (
            value
          ): value is {
            name: string;
            type?: string;
          } => typeof value.name === "string" && value.name.trim().length > 0
        )
        .map((value) => ({
          name: value.name,
          type: value.type,
        })),
      database,
    };
  });
}

export async function findMongoDocuments(input: {
  credentials: MongoDBCredentials;
  request: MongoDbFindDocumentsRequest;
}): Promise<MongoDbFindDocumentsResponse> {
  const access = resolveMongoDatabaseAccess(input.credentials);
  const database = resolveMongoDatabaseName({
    access,
    requestedDatabase: input.request.database,
  });
  const collection = normalizeMongoCollectionName(input.request.collection);
  const limit = normalizePositiveInt(input.request.limit, {
    defaultValue: DEFAULT_QUERY_LIMIT,
    field: "limit",
    max: MAX_QUERY_LIMIT,
    min: 1,
  });
  const skip = normalizePositiveInt(input.request.skip, {
    defaultValue: 0,
    field: "skip",
    max: 100_000,
    min: 0,
  });
  const maxTimeMs = normalizePositiveInt(input.request.maxTimeMs, {
    defaultValue: DEFAULT_QUERY_MAX_TIME_MS,
    field: "maxTimeMs",
    max: 60_000,
    min: 1,
  });
  validateMongoQueryValue(input.request.filter ?? {}, "filter");
  validateMongoQueryValue(input.request.projection ?? {}, "projection");
  validateMongoQueryValue(input.request.sort ?? {}, "sort");

  return withMongoClient(input.credentials, async (client) => {
    const documents = await client
      .db(database)
      .collection(collection)
      .find(input.request.filter ?? {}, {
        limit,
        maxTimeMS: maxTimeMs,
        projection: input.request.projection,
        skip,
        sort: input.request.sort,
      })
      .toArray();

    const serializedDocuments = serializeMongoDocuments(documents);
    return {
      collection,
      count: serializedDocuments.length,
      database,
      documents: serializedDocuments,
    };
  });
}
