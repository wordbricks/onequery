import type { MongoDBCredentials } from "@onequery/db/server";
import { isMongoCredentials } from "@onequery/db/server";

import type { MongoDbSourceApiRequest } from "../../source-api/adapters/mongodb";
import {
  MongoDbInvalidRequestError,
  mongodbSourceApiOperationSchema,
  parseMongoDbProviderRouteRequest,
  requestMongoDbSourceApi,
} from "../../source-api/adapters/mongodb";
import { createProviderRoute } from "./create-provider-route";

export const dataSourcesMongoDbQueryRoute = createProviderRoute<
  MongoDBCredentials,
  typeof mongodbSourceApiOperationSchema,
  MongoDbSourceApiRequest["request"],
  "/mongodb/query"
>({
  buildConflictMessage: ({ multipleDefaults }) =>
    multipleDefaults
      ? "Multiple default MongoDB data sources found. Keep only one MongoDB data source with useAsDataSource=true."
      : "Multiple active MongoDB data sources found. Set exactly one as default (useAsDataSource=true).",
  credentialsGuard: (creds): creds is MongoDBCredentials =>
    typeof creds === "object" &&
    creds !== null &&
    "type" in creds &&
    isMongoCredentials(creds as Parameters<typeof isMongoCredentials>[0]),
  execute: async ({ c, credentials, method, request }) => {
    try {
      const response = await requestMongoDbSourceApi({
        credentials,
        operation: method,
        request,
      });

      if (response.body.kind !== "json") {
        throw new Error("MongoDB route expected a JSON response body");
      }

      return response.body.value;
    } catch (error) {
      if (error instanceof MongoDbInvalidRequestError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  },
  methodSchema: mongodbSourceApiOperationSchema,
  missingDataSourceMessage: "Active MongoDB data source not found",
  parseRequest: (input) =>
    parseMongoDbProviderRouteRequest({
      operation: input.method,
      request: input.request,
    }),
  provider: "mongodb",
  providerLabel: "MongoDB",
  routePath: "/mongodb/query",
});
