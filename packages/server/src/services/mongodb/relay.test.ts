import { describe, expect, it } from "vitest";

import { findMongoDocuments, listMongoCollections } from "./relay";

const credentials = {
  connectionString: "mongodb://user:pass@localhost:27017/admin",
  database: "admin",
  type: "mongodb" as const,
};

describe("mongodb relay", () => {
  it.each([
    [
      "invalid requested database names before connecting",
      () =>
        listMongoCollections({
          credentials,
          request: {
            database: "admin/system",
          },
        }),
      "database is invalid",
    ],
    [
      "invalid collection names before connecting",
      () =>
        findMongoDocuments({
          credentials,
          request: {
            collection: "$cmd",
          },
        }),
      "collection is invalid",
    ],
    [
      "dangerous mongo operators in filters",
      () =>
        findMongoDocuments({
          credentials,
          request: {
            collection: "events",
            filter: {
              $where: "this.secret === true",
            },
          },
        }),
      "filter contains unsupported operator $where",
    ],
  ])("rejects %s", async (_label, invoke, message) => {
    await expect(invoke()).rejects.toThrow(message);
  });
});
