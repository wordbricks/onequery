import { describe, expect, it } from "vitest";

import {
  base64ToBuffer,
  base64ToBytes,
  base64ToUtf8,
  base64UrlToBuffer,
  base64UrlToBytes,
  base64UrlToUtf8,
} from "@/base64";

describe("base64 codecs", () => {
  it("round-trips standard base64 bytes", () => {
    const bytes = new Uint8Array([251, 255, 1, 2]);

    const encoded = base64ToBytes.encode(bytes);

    expect(encoded).toBe("+/8BAg==");
    expect(base64ToBytes.decode(encoded)).toEqual(bytes);
  });

  it("round-trips standard base64 buffers", () => {
    const buffer = Uint8Array.from([1, 2, 3, 4]).buffer;

    const encoded = base64ToBuffer.encode(buffer);
    const decoded = new Uint8Array(base64ToBuffer.decode(encoded));

    expect(encoded).toBe("AQIDBA==");
    expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("round-trips standard base64 utf8 strings", () => {
    const encoded = base64ToUtf8.encode("hello world");

    expect(encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(base64ToUtf8.decode(encoded)).toBe("hello world");
  });
});

describe("base64url codecs", () => {
  it("encodes url-safe unpadded strings", () => {
    const bytes = new Uint8Array([251, 255, 1, 2]);

    const encoded = base64UrlToBytes.encode(bytes);

    expect(encoded).toBe("-_8BAg");
    expect(base64UrlToBytes.decode(encoded)).toEqual(bytes);
  });

  it("decodes padded or standard alphabet input", () => {
    expect(base64UrlToBytes.decode("-_8BAg==")).toEqual(
      new Uint8Array([251, 255, 1, 2])
    );
    expect(base64UrlToBytes.decode("+/8BAg==")).toEqual(
      new Uint8Array([251, 255, 1, 2])
    );
  });

  it("round-trips buffers", () => {
    const buffer = Uint8Array.from([251, 255, 1, 2]).buffer;
    const encoded = base64UrlToBuffer.encode(buffer);
    const decoded = new Uint8Array(base64UrlToBuffer.decode(encoded));

    expect(encoded).toBe("-_8BAg");
    expect(decoded).toEqual(new Uint8Array([251, 255, 1, 2]));
  });

  it("round-trips utf8 strings", () => {
    const encoded = base64UrlToUtf8.encode('{"hello":"world"}');

    expect(encoded).toBe("eyJoZWxsbyI6IndvcmxkIn0");
    expect(base64UrlToUtf8.decode(encoded)).toBe('{"hello":"world"}');
  });
});
