import type { Statement } from "@casual-simulation/sql-parser";
import initWasm, {
  format,
  initSync,
  parse_sql,
} from "@casual-simulation/sql-parser/pkg/sql_parser_wasm.js";
import type { InitInput } from "@casual-simulation/sql-parser/pkg/sql_parser_wasm.js";
import { isRecord } from "@onequery/base";

import { isNodeLike } from "./wasm-runtime";

const parserState: {
  promise?: Promise<void>;
} = {};

export async function ensureSqlParserInit(): Promise<void> {
  if (parserState.promise) {
    return parserState.promise;
  }

  const promise = (
    isNodeLike ? initSqlParserInNode() : initSqlParserInWorker()
  ).then(() => {});
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

async function initSqlParserInWorker(): Promise<void> {
  const wasmImport =
    await import("@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm");
  const wasmModule = unwrapDefaultExport(wasmImport);
  await initWasm(toInitInput(wasmModule));
}

async function initSqlParserInNode(): Promise<void> {
  if (!isNodeLike) {
    await initWasm();
    return;
  }

  const [{ readFile }, { createRequire }] = await Promise.all([
    import("node:fs/promises"),
    import("node:module"),
  ]);
  const require = createRequire(import.meta.url);
  const wasmPath =
    require.resolve("@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm");
  const bytes = await readFile(wasmPath);
  initSync({ module: bytes });
}

function unwrapDefaultExport(value: unknown): unknown {
  if (!isRecord(value) || !("default" in value)) {
    return value;
  }

  return value.default;
}

function toInitInput(value: unknown): InitInput {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof WebAssembly.Module) {
    return value;
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }

  if (typeof Request === "function" && value instanceof Request) {
    return value;
  }

  if (typeof Response === "function" && value instanceof Response) {
    return value;
  }

  if (typeof URL === "function" && value instanceof URL) {
    return value;
  }

  throw new Error("Invalid SQL parser WASM module");
}
