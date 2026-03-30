import { z } from "zod";

export const stringToNumber = z.codec(
  z.string().regex(z.regexes.number),
  z.number(),
  {
    decode: (value) => Number.parseFloat(value),
    encode: (value) => value.toString(),
  }
);

export const stringToInt = z.codec(
  z.string().regex(z.regexes.integer),
  z.int(),
  {
    decode: (value) => Number.parseInt(value, 10),
    encode: (value) => value.toString(),
  }
);
