import { describe, expect, it } from "vitest";

import { PROVIDER_TYPES, QUERYABLE_PROVIDER_TYPES } from "./data-sources";

describe("data-sources schema", () => {
  describe("PROVIDER_TYPES", () => {
    it("should include all expected provider types", () => {
      const expected = [
        "postgres",
        "supabase",
        "mysql",
        "mongodb",
        "bigquery",
        "laminar",
        "aws_athena_connector",
        "ga",
        "amplitude",
        "mixpanel",
        "posthog",
        "sentry",
        "github",
        "linear",
      ];
      expect(PROVIDER_TYPES).toEqual(expected);
    });
  });

  describe("QUERYABLE_PROVIDER_TYPES", () => {
    it("should include all queryable provider types", () => {
      const expected = [
        "postgres",
        "supabase",
        "mysql",
        "mongodb",
        "bigquery",
        "laminar",
        "aws_athena_connector",
        "ga",
        "amplitude",
        "mixpanel",
        "posthog",
        "sentry",
        "github",
        "linear",
      ];
      expect(QUERYABLE_PROVIDER_TYPES).toEqual(expected);
    });

    it("should be a subset of PROVIDER_TYPES", () => {
      for (const provider of QUERYABLE_PROVIDER_TYPES) {
        expect(PROVIDER_TYPES).toContain(provider);
      }
    });

    it("should match the OSS provider surface", () => {
      expect(QUERYABLE_PROVIDER_TYPES).toEqual(PROVIDER_TYPES);
    });
  });
});
