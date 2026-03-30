import { z } from "zod";

export const hexToBytes = z.codec(z.hex(), z.instanceof(Uint8Array), {
  decode: (value) => z.util.hexToUint8Array(value),
  encode: (value) => z.util.uint8ArrayToHex(value),
});

export const hexToBuffer = z.codec(z.hex(), z.instanceof(ArrayBuffer), {
  decode: (value) => {
    const bytes = z.util.hexToUint8Array(value);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  },
  encode: (value) => z.util.uint8ArrayToHex(new Uint8Array(value)),
});
