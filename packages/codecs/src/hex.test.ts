import { describe, expect, it } from "vitest";

import { hexToBuffer, hexToBytes } from "./hex";

function serializeBytes(bytes: Uint8Array): number[] {
  return [...bytes];
}

function serializeBuffer(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

describe("hexToBytes", () => {
  it("matches byte codec snapshots", () => {
    expect({
      decode: {
        "empty string": serializeBytes(hexToBytes.decode("")),
        "leading zeros": serializeBytes(hexToBytes.decode("00ff")),
        "mixed-case hex": serializeBytes(hexToBytes.decode("AbCdEf")),
        "single byte": serializeBytes(hexToBytes.decode("ff")),
      },
      encode: {
        "all zeros": hexToBytes.encode(new Uint8Array([0, 0, 0])),
        "empty Uint8Array": hexToBytes.encode(new Uint8Array([])),
        "leading zeros": hexToBytes.encode(new Uint8Array([0, 255])),
        "multi-byte array": hexToBytes.encode(
          new Uint8Array([0xde, 0xad, 0xbe, 0xef])
        ),
      },
    }).toMatchSnapshot();
  });

  describe("validation (decode)", () => {
    it.each([
      ["invalid hex characters", "xyz"],
      ["non-string input", 123],
    ])("fails on %s", (_name, input) => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBytes.safeDecode(input);
      expect(result.success).toBe(false);
    });

    it("throws on odd-length hex string", () => {
      // z.hex() validates even length before codec decode is called
      // but z.util.hexToUint8Array throws on odd length during decode
      expect(() => hexToBytes.safeDecode("abc")).toThrow();
    });
  });

  describe("validation (encode)", () => {
    it("fails on non-Uint8Array input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBytes.safeEncode([1, 2, 3]);
      expect(result.success).toBe(false);
    });
  });
});

describe("hexToBuffer", () => {
  it("matches buffer codec snapshots", () => {
    const multiByteBuffer = new ArrayBuffer(4);
    new Uint8Array(multiByteBuffer).set([0xde, 0xad, 0xbe, 0xef]);

    const singleByteBuffer = new ArrayBuffer(1);
    new Uint8Array(singleByteBuffer)[0] = 0x42;

    expect({
      decode: {
        "empty string": serializeBuffer(hexToBuffer.decode("")),
        "multi-byte hex string": serializeBuffer(
          hexToBuffer.decode("deadbeef")
        ),
        "single byte": serializeBuffer(hexToBuffer.decode("42")),
      },
      encode: {
        "empty ArrayBuffer": hexToBuffer.encode(new ArrayBuffer(0)),
        "multi-byte ArrayBuffer": hexToBuffer.encode(multiByteBuffer),
        "single-byte buffer": hexToBuffer.encode(singleByteBuffer),
        "zero-filled buffer": hexToBuffer.encode(new ArrayBuffer(3)),
      },
    }).toMatchSnapshot();
  });

  describe("validation (decode)", () => {
    it("fails on invalid hex", () => {
      const result = hexToBuffer.safeDecode("gggg");
      expect(result.success).toBe(false);
    });

    it("throws on odd-length hex", () => {
      // z.hex() validates even length before codec decode is called
      // but z.util.hexToUint8Array throws on odd length during decode
      expect(() => hexToBuffer.safeDecode("abc")).toThrow();
    });
  });

  describe("validation (encode)", () => {
    it("fails on non-ArrayBuffer input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBuffer.safeEncode(new Uint8Array([1, 2]));
      expect(result.success).toBe(false);
    });
  });
});
