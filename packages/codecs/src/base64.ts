import { z } from "zod";

import { utf8ToBytes } from "./utf8";

type Base64Format = "base64" | "base64url";

function bytesToBinary(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCodePoint(byte);
  }

  return binary;
}

function binaryToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(value.length);
  const view = new Uint8Array(buffer);

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }

    view[index] = codePoint;
  }

  return view;
}

function toBase64Padding(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) {
    return value;
  }

  return `${value}${"=".repeat(4 - remainder)}`;
}

function decodeBase64Bytes(
  value: string,
  ctx: z.core.ParsePayload<string>,
  format: Base64Format
): Uint8Array<ArrayBuffer> {
  const normalized =
    format === "base64url"
      ? value.replaceAll("-", "+").replaceAll("_", "/")
      : value;

  try {
    return binaryToBytes(atob(toBase64Padding(normalized)));
  } catch {
    ctx.issues.push({
      code: "invalid_format",
      format,
      input: value,
      message: `Invalid ${format}`,
    });
    return z.NEVER;
  }
}

function bytesToBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function encodeBase64Bytes(value: Uint8Array, format: Base64Format): string {
  const encoded = btoa(bytesToBinary(value));
  if (format === "base64") {
    return encoded;
  }

  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createBase64BytesCodec(format: Base64Format) {
  return z.codec(z.string(), z.instanceof(Uint8Array), {
    decode: (value, ctx) => decodeBase64Bytes(value, ctx, format),
    encode: (value) => encodeBase64Bytes(value, format),
  });
}

function createBase64BufferCodec(format: Base64Format) {
  return z.codec(z.string(), z.instanceof(ArrayBuffer), {
    decode: (value, ctx) => {
      const bytes = decodeBase64Bytes(value, ctx, format);
      if (bytes === z.NEVER) {
        return z.NEVER;
      }

      return bytesToBuffer(bytes);
    },
    encode: (value) => encodeBase64Bytes(new Uint8Array(value), format),
  });
}

function createBase64Utf8Codec(format: Base64Format) {
  return z.codec(z.string(), z.string(), {
    decode: (value, ctx) => {
      const bytes = decodeBase64Bytes(value, ctx, format);
      if (bytes === z.NEVER) {
        return z.NEVER;
      }

      return utf8ToBytes.encode(bytes);
    },
    encode: (value) => encodeBase64Bytes(utf8ToBytes.decode(value), format),
  });
}

export const base64ToBytes = createBase64BytesCodec("base64");

export const base64ToBuffer = createBase64BufferCodec("base64");

export const base64ToUtf8 = createBase64Utf8Codec("base64");

export const base64UrlToBytes = createBase64BytesCodec("base64url");

export const base64UrlToBuffer = createBase64BufferCodec("base64url");

export const base64UrlToUtf8 = createBase64Utf8Codec("base64url");
