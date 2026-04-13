import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("matches merged class name snapshots", () => {
    expect({
      arrays: cn(["foo", "bar"]),
      conditional: cn("foo", false, "baz"),
      empty: cn(),
      merge: cn("foo", "bar"),
      objects: cn({ bar: false, baz: true, foo: true }),
      tailwind: cn("px-2 py-1", "px-4"),
    }).toMatchSnapshot();
  });
});
