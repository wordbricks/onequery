import assert from "node:assert";

import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

const HEX_ESCAPE_REGEX = /\\x/g;
// Comment: Drizzle bytea custom type workaround:
// https://github.com/drizzle-team/drizzle-orm/issues/298#issuecomment-3223856537
export const bytea = customType<{
  data: Buffer;
  notNull: false;
  default: false;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(value: unknown) {
    assert(value instanceof Buffer);

    return sql`decode(${value.toString("hex")}, 'hex')`;
  },
  fromDriver(value: unknown): Buffer {
    if (value instanceof Buffer) {
      return value;
    }

    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }

    if (typeof value === "string") {
      return Buffer.from(value.replace(HEX_ESCAPE_REGEX, ""), "hex");
    }

    assert.fail(`Cannot convert type: '${typeof value}' to Buffer`);
  },
});
