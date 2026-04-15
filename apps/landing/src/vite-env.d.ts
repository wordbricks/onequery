/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LANDING_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
