import { describe, expect, it } from "vitest";

import { hexToBuffer, hexToBytes } from "./hex";

describe("hexToBytes", () => {
  describe("decode (hex string -> Uint8Array)", () => {
    it("should decode empty hex string to empty Uint8Array", () => {
      const result = hexToBytes.decode("");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });

    it("should decode single byte hex", () => {
      const result = hexToBytes.decode("ff");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(new Uint8Array([255]));
    });

    it("should decode multi-byte hex", () => {
      const result = hexToBytes.decode("deadbeef");
      expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it("should decode lowercase hex", () => {
      const result = hexToBytes.decode("abcdef");
      expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    });

    it("should decode uppercase hex", () => {
      const result = hexToBytes.decode("ABCDEF");
      expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    });

    it("should decode mixed case hex", () => {
      const result = hexToBytes.decode("AbCdEf");
      expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]));
    });

    it("should decode zeros", () => {
      const result = hexToBytes.decode("0000");
      expect(result).toEqual(new Uint8Array([0, 0]));
    });

    it("should decode leading zeros", () => {
      const result = hexToBytes.decode("00ff");
      expect(result).toEqual(new Uint8Array([0, 255]));
    });
  });

  describe("encode (Uint8Array -> hex string)", () => {
    it("should encode empty Uint8Array to empty string", () => {
      const result = hexToBytes.encode(new Uint8Array([]));
      expect(result).toBe("");
    });

    it("should encode single byte", () => {
      const result = hexToBytes.encode(new Uint8Array([255]));
      expect(result).toBe("ff");
    });

    it("should encode multi-byte array", () => {
      const result = hexToBytes.encode(
        new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      );
      expect(result).toBe("deadbeef");
    });

    it("should encode zeros with leading zeros preserved", () => {
      const result = hexToBytes.encode(new Uint8Array([0, 255]));
      expect(result).toBe("00ff");
    });

    it("should encode all zeros", () => {
      const result = hexToBytes.encode(new Uint8Array([0, 0, 0]));
      expect(result).toBe("000000");
    });

    it("should produce lowercase hex", () => {
      const result = hexToBytes.encode(new Uint8Array([0xab, 0xcd, 0xef]));
      expect(result).toBe("abcdef");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip empty data", () => {
      const original = "";
      const decoded = hexToBytes.decode(original);
      const encoded = hexToBytes.encode(decoded);
      expect(encoded).toBe(original);
    });

    it("should roundtrip arbitrary hex data", () => {
      const original = "48656c6c6f"; // "Hello" in hex
      const decoded = hexToBytes.decode(original);
      const encoded = hexToBytes.encode(decoded);
      expect(encoded).toBe(original);
    });

    it("should roundtrip from bytes", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = hexToBytes.encode(original);
      const decoded = hexToBytes.decode(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe("validation (decode)", () => {
    it("should fail on invalid hex characters", () => {
      const result = hexToBytes.safeDecode("xyz");
      expect(result.success).toBe(false);
    });

    it("should throw on odd-length hex string", () => {
      // z.hex() validates even length before codec decode is called
      // but z.util.hexToUint8Array throws on odd length during decode
      expect(() => hexToBytes.safeDecode("abc")).toThrow();
    });

    it("should fail on hex with spaces", () => {
      const result = hexToBytes.safeDecode("ab cd");
      expect(result.success).toBe(false);
    });

    it("should fail on hex with 0x prefix", () => {
      const result = hexToBytes.safeDecode("0xabcd");
      expect(result.success).toBe(false);
    });

    it("should fail on non-string input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBytes.safeDecode(123);
      expect(result.success).toBe(false);
    });
  });

  describe("validation (encode)", () => {
    it("should fail on non-Uint8Array input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBytes.safeEncode([1, 2, 3]);
      expect(result.success).toBe(false);
    });
  });
});

describe("hexToBuffer", () => {
  describe("decode (hex string -> ArrayBuffer)", () => {
    it("should decode empty hex string to empty ArrayBuffer", () => {
      const result = hexToBuffer.decode("");
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(0);
    });

    it("should decode hex to ArrayBuffer", () => {
      const result = hexToBuffer.decode("deadbeef");
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(4);
      expect(new Uint8Array(result)).toEqual(
        new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      );
    });

    it("should decode single byte", () => {
      const result = hexToBuffer.decode("42");
      expect(result.byteLength).toBe(1);
      expect(new Uint8Array(result)[0]).toBe(0x42);
    });
  });

  describe("encode (ArrayBuffer -> hex string)", () => {
    it("should encode empty ArrayBuffer to empty string", () => {
      const result = hexToBuffer.encode(new ArrayBuffer(0));
      expect(result).toBe("");
    });

    it("should encode ArrayBuffer to hex", () => {
      const buffer = new ArrayBuffer(4);
      new Uint8Array(buffer).set([0xde, 0xad, 0xbe, 0xef]);
      const result = hexToBuffer.encode(buffer);
      expect(result).toBe("deadbeef");
    });

    it("should encode single byte buffer", () => {
      const buffer = new ArrayBuffer(1);
      new Uint8Array(buffer)[0] = 0x42;
      const result = hexToBuffer.encode(buffer);
      expect(result).toBe("42");
    });

    it("should encode zeros correctly", () => {
      const buffer = new ArrayBuffer(3);
      const result = hexToBuffer.encode(buffer);
      expect(result).toBe("000000");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip hex data through ArrayBuffer", () => {
      const original = "cafebabe";
      const decoded = hexToBuffer.decode(original);
      const encoded = hexToBuffer.encode(decoded);
      expect(encoded).toBe(original);
    });

    it("should roundtrip from ArrayBuffer", () => {
      const original = new ArrayBuffer(4);
      new Uint8Array(original).set([1, 2, 3, 4]);
      const encoded = hexToBuffer.encode(original);
      const decoded = hexToBuffer.decode(encoded);
      expect([...new Uint8Array(decoded)]).toEqual([
        ...new Uint8Array(original),
      ]);
    });
  });

  describe("validation (decode)", () => {
    it("should fail on invalid hex", () => {
      const result = hexToBuffer.safeDecode("gggg");
      expect(result.success).toBe(false);
    });

    it("should throw on odd-length hex", () => {
      // z.hex() validates even length before codec decode is called
      // but z.util.hexToUint8Array throws on odd length during decode
      expect(() => hexToBuffer.safeDecode("abc")).toThrow();
    });
  });

  describe("validation (encode)", () => {
    it("should fail on non-ArrayBuffer input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = hexToBuffer.safeEncode(new Uint8Array([1, 2]));
      expect(result.success).toBe(false);
    });
  });
});
