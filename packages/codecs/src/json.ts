import { z } from "zod";

import { base64UrlToUtf8 } from "./base64";

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

export const base64UrlJsonCodec = <T extends z.core.$ZodType>(schema: T) =>
  z.codec(z.string(), schema, {
    decode: (encodedValue, ctx) => {
      const decodedText = base64UrlToUtf8.safeDecode(encodedValue);
      if (!decodedText.success) {
        ctx.issues.push({
          code: "invalid_format",
          format: "base64url",
          input: encodedValue,
          message: decodedText.error.issues[0]?.message ?? "Invalid base64url",
        });
        return z.NEVER;
      }

      try {
        return JSON.parse(decodedText.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";
        ctx.issues.push({
          code: "invalid_format",
          format: "base64url-json",
          input: encodedValue,
          message,
        });
        return z.NEVER;
      }
    },
    encode: (value) => base64UrlToUtf8.encode(JSON.stringify(value)),
  });
