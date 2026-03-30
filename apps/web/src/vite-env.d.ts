/// <reference types="vite/client" />

declare global {
  var __ONEQUERY_E2E__: boolean | undefined;

  interface GlobalThis {
    __ONEQUERY_E2E__?: boolean;
  }
}

declare module "@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm" {
  const mod: WebAssembly.Module | ArrayBuffer | Uint8Array | string;
  export default mod;
}
