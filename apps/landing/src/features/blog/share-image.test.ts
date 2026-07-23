import type { ImageMetadata } from "astro";
import { describe, expect, it } from "vitest";

import { getBlogShareImageSource } from "./share-image";

describe("getBlogShareImageSource", () => {
  it("uses a square blog thumbnail as the social share image", () => {
    const thumbnail = {
      format: "png",
      height: 1254,
      src: "/images/hunting-web-bugs-with-jam-and-agents-icon.png",
      width: 1254,
    } as ImageMetadata;

    expect(
      getBlogShareImageSource({
        coverImage: {
          alt: "OneQuery connected to Jam",
          src: thumbnail,
        },
      })
    ).toBe(thumbnail);
  });
});
