import {
  LOCAL_TEST_DATABASE_URL,
  LOCAL_WEB_ORIGIN,
} from "@onequery/dev-config/topology";

import type { ServerEnv } from "../env";

const defaultEnv: ServerEnv = {
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  BETTER_AUTH_URL: LOCAL_WEB_ORIGIN,
  DATABASE_URL: LOCAL_TEST_DATABASE_URL,
  MASTER_ENCRYPTION_KEY: "sample-encryption-key",
  WEB_URL: LOCAL_WEB_ORIGIN,
};

export function createTestEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    ...defaultEnv,
    ...overrides,
  };
}
