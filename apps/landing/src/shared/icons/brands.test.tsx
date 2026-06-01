import { listPublicSourceProviders } from "@onequery/db/source-providers";
import { describe, expect, it } from "vitest";

import { hasBrandIcon } from "./brands";

describe("brand icons", () => {
  it("has a landing icon for every public source provider", () => {
    expect(
      listPublicSourceProviders().filter(
        (provider) => !hasBrandIcon(provider.id)
      )
    ).toEqual([]);
  });
});
