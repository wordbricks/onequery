import { describe, expect, it } from "vitest";

import { hexToBuffer, hexToBytes } from "./hex";

describe("hexToBytes", () => {
  it.each([
    {
      name: "decodes an empty string",
      input: "",
      expected: new Uint8Array([]),
    },
    {
      name: "decodes a single byte",
      input: "ff",
      expected: new Uint8Array([255]),
    },
    {
      name: "decodes mixed-case hex",
      input: "AbCdEf",
      expected: new Uint8Array([0xab, 0xcd, 0xef]),
    },
    {
      name: "preserves leading zeros",
      input: "00ff",
      expected: new Uint8Array([0, 255]),
    },
  ])("$name", ({ input, expected }) => {
    expect(hexToBytes.decode(input)).toEqual(expected);
  });

  it.each([
    {
      name: "encodes an empty Uint8Array",
      value: new Uint8Array([]),
      expected: "",
    },
    {
      name: "encodes a multi-byte array",
      value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      expected: "deadbeef",
    },
    {
      name: "encodes leading zeros",
      value: new Uint8Array([0, 255]),
      expected: "00ff",
    },
    {
      name: "encodes all zeros",
      value: new Uint8Array([0, 0, 0]),
      expected: "000000",
    },
  ])("$name", ({ value, expected }) => {
    expect(hexToBytes.encode(value)).toBe(expected);
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
  it.each([
    {
      name: "decodes an empty string",
      input: "",
      expected: new Uint8Array([]),
    },
    {
      name: "decodes a multi-byte hex string",
      input: "deadbeef",
      expected: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    },
    {
      name: "decodes a single byte",
      input: "42",
      expected: new Uint8Array([0x42]),
    },
  ])("$name", ({ input, expected }) => {
    const result = hexToBuffer.decode(input);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(expected);
  });

  it.each([
    {
      name: "encodes an empty ArrayBuffer",
      value: new ArrayBuffer(0),
      expected: "",
    },
    {
      name: "encodes a multi-byte ArrayBuffer",
      value: (() => {
        const buffer = new ArrayBuffer(4);
        new Uint8Array(buffer).set([0xde, 0xad, 0xbe, 0xef]);
        return buffer;
      })(),
      expected: "deadbeef",
    },
    {
      name: "encodes a single-byte buffer",
      value: (() => {
        const buffer = new ArrayBuffer(1);
        new Uint8Array(buffer)[0] = 0x42;
        return buffer;
      })(),
      expected: "42",
    },
    {
      name: "encodes zero-filled buffer",
      value: new ArrayBuffer(3),
      expected: "000000",
    },
  ])("$name", ({ value, expected }) => {
    expect(hexToBuffer.encode(value)).toBe(expected);
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
