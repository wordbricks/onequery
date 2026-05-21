/// <reference types="vite/client" />

declare global {
  var __ONEQUERY_E2E__: boolean | undefined;

  interface GlobalThis {
    __ONEQUERY_E2E__?: boolean;
  }
}
