import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  getLandingDevPort,
  LANDING_DEV_SERVER_HOST,
} from "./src/landing-config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
  },
  server: {
    host: LANDING_DEV_SERVER_HOST,
    port: getLandingDevPort(),
    strictPort: true,
  },
});
