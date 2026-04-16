/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LANDING_API_BASE_URL?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
