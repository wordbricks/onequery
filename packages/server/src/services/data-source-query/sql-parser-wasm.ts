import { existsSync } from "node:fs";

import type { Statement } from "@casual-simulation/sql-parser";
import {
  format,
  initSync,
  parse_sql,
} from "@casual-simulation/sql-parser/pkg/sql_parser_wasm.js";
import {
  resolvePackagedRuntimeAssetPath,
  resolveRuntimeRoot,
} from "@onequery/base/runtime-bundle";

const SQL_PARSER_RUNTIME_ASSET_FAMILY = "sqlParser";
const SQL_PARSER_WASM_FILE_ROLE = "wasm";

const parserState: {
  promise?: Promise<void>;
} = {};

export async function ensureSqlParserInit(): Promise<void> {
  if (parserState.promise) {
    return parserState.promise;
  }

  const promise = initSqlParserInNode().then(() => {});
  parserState.promise = promise;
  return promise;
}

export function parseSqlStatements(sql: string, dialect: string): Statement[] {
  const parsed: unknown = parse_sql(dialect, sql);
  if (!Array.isArray(parsed)) {
    throw new TypeError("Failed to parse SQL: invalid AST");
  }

  return parsed;
}

export function formatStatement(statement: Statement): string {
  return format(statement);
}

async function initSqlParserInNode(): Promise<void> {
  const [{ readFile }, wasmPath] = await Promise.all([
    import("node:fs/promises"),
    resolveSqlParserWasmPath(),
  ]);
  const bytes = await readFile(wasmPath);
  initSync({ module: bytes });
}

async function resolveSqlParserWasmPath(): Promise<string> {
  const explicitWasmPath = resolvePackagedSqlParserWasmPath();
  if (explicitWasmPath) {
    return explicitWasmPath;
  }

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require.resolve("@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm");
}

function resolvePackagedSqlParserWasmPath(): string | null {
  const runtimeRoot = resolveRuntimeRoot(process.env);
  if (!runtimeRoot) {
    return null;
  }

  const packagedWasmPath = resolvePackagedRuntimeAssetPath(
    runtimeRoot,
    SQL_PARSER_RUNTIME_ASSET_FAMILY,
    SQL_PARSER_WASM_FILE_ROLE
  );

  if (!existsSync(packagedWasmPath)) {
    return null;
  }

  // Comment: the packaged server bundle runs under Node and resolves the SQL
  // parser wasm from the staged runtime asset directory, not from the bundle.
  return packagedWasmPath;
}
