/**
 * Data templates for the development seed script.
 */

// Stable IDs for the manual development seed dataset.
export const DEV_USER_ID = "dev-user-id";
export const DEV_ORG_ID = "test-org-id";
export const DEV_ORG_SLUG = "test-org";

// Fixed IDs for consistent seeding
export const DATA_SOURCE_IDS = {
  ga: "dev-ds-ga",
  github: "dev-ds-github",
  postgres: "dev-ds-postgres",
} as const;

// Placeholder values for encrypted credentials
export const PLACEHOLDER_ENCRYPTED = "dev-placeholder-encrypted";
export const PLACEHOLDER_IV = "dev-placeholder-iv";
