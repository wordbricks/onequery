import { describe, expect, it } from "vitest";

import { resolveSvgIconAccessibility } from "./svg-icon";

describe("resolveSvgIconAccessibility", () => {
  const baseOptions = {
    ariaHidden: undefined,
    ariaLabel: undefined,
    ariaLabelledBy: undefined,
    defaultLabel: "GitHub",
    role: undefined,
    title: undefined,
  };

  it("treats icons as decorative by default", () => {
    expect(resolveSvgIconAccessibility(baseOptions)).toEqual({
      hidden: true,
      label: undefined,
      labelledBy: undefined,
      role: undefined,
      title: undefined,
    });
  });

  it("exposes icons with an explicit aria label", () => {
    expect(
      resolveSvgIconAccessibility({
        ...baseOptions,
        ariaLabel: "GitHub provider",
      })
    ).toEqual({
      hidden: false,
      label: "GitHub provider",
      labelledBy: undefined,
      role: "img",
      title: "GitHub provider",
    });
  });

  it("uses title as the label when aria-label is not set", () => {
    expect(
      resolveSvgIconAccessibility({
        ...baseOptions,
        title: "GitHub provider",
      })
    ).toEqual({
      hidden: false,
      label: "GitHub provider",
      labelledBy: undefined,
      role: "img",
      title: "GitHub provider",
    });
  });

  it("uses the default label when the caller explicitly exposes the icon", () => {
    expect(
      resolveSvgIconAccessibility({
        ...baseOptions,
        ariaHidden: false,
      })
    ).toEqual({
      hidden: false,
      label: "GitHub",
      labelledBy: undefined,
      role: "img",
      title: "GitHub",
    });
  });

  it("preserves aria-labelledby as the accessible name source", () => {
    expect(
      resolveSvgIconAccessibility({
        ...baseOptions,
        ariaLabelledBy: "github-label",
      })
    ).toEqual({
      hidden: false,
      label: undefined,
      labelledBy: "github-label",
      role: "img",
      title: undefined,
    });
  });

  it("lets aria-hidden override labels", () => {
    expect(
      resolveSvgIconAccessibility({
        ...baseOptions,
        ariaHidden: true,
        ariaLabel: "GitHub provider",
      })
    ).toEqual({
      hidden: true,
      label: undefined,
      labelledBy: undefined,
      role: undefined,
      title: undefined,
    });
  });
});
