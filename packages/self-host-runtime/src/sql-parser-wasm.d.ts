// Comment: @onequery/self-host-runtime composes @onequery/server route exports that depend
// on this WASM module declaration, so it needs the same ambient typing while
// typechecking against those shared server entrypoints.
declare module "@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm" {
  const mod: WebAssembly.Module | ArrayBuffer | Uint8Array | string;
  export default mod;
}
