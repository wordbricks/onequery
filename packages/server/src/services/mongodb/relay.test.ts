import { describe, expect, it } from "vitest";

import { findMongoDocuments, listMongoCollections } from "./relay";

const credentials = {
  connectionString: "mongodb://user:pass@localhost:27017/admin",
  database: "admin",
  type: "mongodb" as const,
};

describe("mongodb relay", () => {
  it("rejects invalid requested database names before connecting", async () => {
    await expect(
      listMongoCollections({
        credentials,
        request: {
          database: "admin/system",
        },
      })
    ).rejects.toThrowError("database is invalid");
  });

  it("rejects invalid collection names before connecting", async () => {
    await expect(
      findMongoDocuments({
        credentials,
        request: {
          collection: "$cmd",
        },
      })
    ).rejects.toThrowError("collection is invalid");
  });

  it("rejects dangerous mongo operators in filters", async () => {
    await expect(
      findMongoDocuments({
        credentials,
        request: {
          collection: "events",
          filter: {
            $where: "this.secret === true",
          },
        },
      })
    ).rejects.toThrowError("filter contains unsupported operator $where");
  });
});
