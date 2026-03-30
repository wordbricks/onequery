import { z } from "zod";

export const stringToURL = z.codec(z.url(), z.instanceof(URL), {
  decode: (value) => new URL(value),
  encode: (value) => value.href,
});

export const stringToHttpURL = z.codec(z.httpUrl(), z.instanceof(URL), {
  decode: (value) => new URL(value),
  encode: (value) => value.href,
});

export const uriComponent = z.codec(z.string(), z.string(), {
  decode: (value, ctx) => {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      ctx.issues.push({
        code: "invalid_format",
        format: "uri-component",
        input: value,
        message:
          error instanceof Error ? error.message : "Invalid URI component",
      });
      return z.NEVER;
    }
  },
  encode: (value, ctx) => {
    try {
      return encodeURIComponent(value);
    } catch (error) {
      ctx.issues.push({
        code: "invalid_format",
        format: "uri-component",
        input: value,
        message:
          error instanceof Error ? error.message : "Invalid URI component",
      });
      return z.NEVER;
    }
  },
});
