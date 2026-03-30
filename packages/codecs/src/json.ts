import { z } from "zod";

export const jsonCodec = <T extends z.core.$ZodType>(schema: T) =>
  z.codec(z.string(), schema, {
    decode: (jsonString, ctx) => {
      try {
        return JSON.parse(jsonString);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";
        ctx.issues.push({
          code: "invalid_format",
          format: "json",
          input: jsonString,
          message,
        });
        return z.NEVER;
      }
    },
    encode: (value) => JSON.stringify(value),
  });
