import { z } from "zod";

export const dateLikeToDate = z.codec(
  z.union([z.date(), z.iso.datetime()]),
  z.date(),
  {
    decode: (value) => (value instanceof Date ? value : new Date(value)),
    encode: (date) => date.toISOString(),
  }
);

export const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (isoString) => new Date(isoString),
  encode: (date) => date.toISOString(),
});

export const epochSecondsToDate = z.codec(z.int().min(0), z.date(), {
  decode: (seconds) => new Date(seconds * 1000),
  encode: (date) => Math.floor(date.getTime() / 1000),
});

export const epochMillisToDate = z.codec(z.int().min(0), z.date(), {
  decode: (millis) => new Date(millis),
  encode: (date) => date.getTime(),
});
