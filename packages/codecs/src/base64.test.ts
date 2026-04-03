import { describe, expect, it } from "vitest";

import {
  base64ToBuffer,
  base64ToBytes,
  base64ToUtf8,
  base64UrlToBuffer,
  base64UrlToBytes,
  base64UrlToUtf8,
} from "@/base64";

type Base64Codec<T> = {
  decode(value: string): T;
  encode(value: T): string;
};

function expectRoundTrip<T>(
  codec: Base64Codec<T>,
  value: T,
  encoded: string
): void {
  const actual = codec.encode(value);
  expect(actual).toBe(encoded);

  const decoded = codec.decode(actual);
  if (value instanceof ArrayBuffer) {
    expect(new Uint8Array(decoded as ArrayBuffer)).toEqual(
      new Uint8Array(value)
    );
    return;
  }

  expect(decoded).toEqual(value);
}

const sampleBytes = Uint8Array.from([251, 255, 1, 2]);
const sampleBuffer = Uint8Array.from([1, 2, 3, 4]).buffer;

describe("base64 codecs", () => {
  it.each([
    {
      name: "round-trips standard base64 bytes",
      codec: base64ToBytes,
      value: sampleBytes,
      encoded: "+/8BAg==",
    },
    {
      name: "round-trips standard base64 buffers",
      codec: base64ToBuffer,
      value: sampleBuffer,
      encoded: "AQIDBA==",
    },
    {
      name: "round-trips standard base64 utf8 strings",
      codec: base64ToUtf8,
      value: "hello world",
      encoded: "aGVsbG8gd29ybGQ=",
    },
  ])("$name", ({ codec, value, encoded }) => {
    expectRoundTrip(codec, value, encoded);
  });
});

describe("base64url codecs", () => {
  it.each([
    {
      name: "round-trips url-safe bytes",
      codec: base64UrlToBytes,
      value: sampleBytes,
      encoded: "-_8BAg",
    },
    {
      name: "round-trips buffers",
      codec: base64UrlToBuffer,
      value: sampleBytes.buffer,
      encoded: "-_8BAg",
    },
    {
      name: "round-trips utf8 strings",
      codec: base64UrlToUtf8,
      value: '{"hello":"world"}',
      encoded: "eyJoZWxsbyI6IndvcmxkIn0",
    },
  ])("$name", ({ codec, value, encoded }) => {
    expectRoundTrip(codec, value, encoded);
  });

  it.each([
    ["-_8BAg==", sampleBytes],
    ["+/8BAg==", sampleBytes],
  ])("decodes %s", (input, expected) => {
    expect(base64UrlToBytes.decode(input)).toEqual(expected);
  });
});
