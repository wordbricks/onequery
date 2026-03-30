// Comment: @onequery/server exports query helpers that depend on this WASM module
// declaration, so @onequery/cli-server needs the same ambient typing while it
// typechecks against those exported server entrypoints.
declare module "@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm" {
  const mod: WebAssembly.Module | ArrayBuffer | Uint8Array | string;
  export default mod;
}
