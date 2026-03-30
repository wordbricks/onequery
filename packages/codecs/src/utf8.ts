import { z } from "zod";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8ToBytes = z.codec(z.string(), z.instanceof(Uint8Array), {
  decode: (value) => {
    const bytes = encoder.encode(value);
    const buffer = new ArrayBuffer(bytes.byteLength);
    const view = new Uint8Array(buffer);
    view.set(bytes);
    return view;
  },
  encode: (value) => decoder.decode(value),
});

export const utf8ToBuffer = z.codec(z.string(), z.instanceof(ArrayBuffer), {
  decode: (value) => {
    const bytes = encoder.encode(value);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  },
  encode: (value) => decoder.decode(new Uint8Array(value)),
});
