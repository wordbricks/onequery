import { describe, expect, it } from "vitest";
import { z } from "zod";

import { base64UrlJsonCodec } from "@/json";

const CursorCodec = base64UrlJsonCodec(
  z
    .object({
      offset: z.number().int().min(0),
    })
    .strict()
);

describe("base64UrlJsonCodec", () => {
  it("round-trips base64url encoded JSON payloads", () => {
    const encoded = CursorCodec.encode({ offset: 25 });

    expect(CursorCodec.decode(encoded)).toEqual({ offset: 25 });
  });

  it("rejects invalid base64url payloads", () => {
    const result = CursorCodec.safeDecode("not-a-cursor");

    expect(result.success).toBe(false);
  });

  it("rejects structurally invalid decoded payloads", () => {
    const invalid = Buffer.from(JSON.stringify({ offset: -1 })).toString(
      "base64url"
    );
    const result = CursorCodec.safeDecode(invalid);

    expect(result.success).toBe(false);
  });
});
