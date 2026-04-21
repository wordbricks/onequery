import { relations } from "drizzle-orm";

import { organization, user } from "./auth";
import { bigqueryQueryCosts } from "./bigquery-query-costs";
import { connectorJobs, connectors } from "./connectors";
import { dataSourceQueryCosts } from "./data-source-query-costs";
import { dataSourceTableUsage } from "./data-source-table-usage";
import { dataSources } from "./data-sources";
import { organizationProfiles } from "./organization-profiles";
import { userProfiles } from "./user-profiles";

export const organizationProfilesRelations = relations(
  organizationProfiles,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationProfiles.organizationId],
      references: [organization.id],
    }),
  })
);

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, {
    fields: [userProfiles.userId],
    references: [user.id],
  }),
}));

export const connectorsRelations = relations(connectors, ({ many, one }) => ({
  jobs: many(connectorJobs),
  organization: one(organization, {
    fields: [connectors.organizationId],
    references: [organization.id],
  }),
  queryCosts: many(dataSourceQueryCosts),
}));

export const connectorJobsRelations = relations(connectorJobs, ({ one }) => ({
  connector: one(connectors, {
    fields: [connectorJobs.connectorId],
    references: [connectors.connectorId],
  }),
}));

export const dataSourceQueryCostsRelations = relations(
  dataSourceQueryCosts,
  ({ one }) => ({
    connector: one(connectors, {
      fields: [dataSourceQueryCosts.connectorId],
      references: [connectors.connectorId],
    }),
    organization: one(organization, {
      fields: [dataSourceQueryCosts.organizationId],
      references: [organization.id],
    }),
  })
);

export const bigqueryQueryCostsRelations = relations(
  bigqueryQueryCosts,
  ({ one }) => ({
    organization: one(organization, {
      fields: [bigqueryQueryCosts.organizationId],
      references: [organization.id],
    }),
  })
);

export const dataSourceTableUsageRelations = relations(
  dataSourceTableUsage,
  ({ one }) => ({
    dataSource: one(dataSources, {
      fields: [dataSourceTableUsage.dataSourceId],
      references: [dataSources.id],
    }),
    memoUpdatedByUser: one(user, {
      fields: [dataSourceTableUsage.memoUpdatedBy],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [dataSourceTableUsage.organizationId],
      references: [organization.id],
    }),
  })
);

export const dataSourcesRelations = relations(dataSources, ({ one }) => ({
  organization: one(organization, {
    fields: [dataSources.organizationId],
    references: [organization.id],
  }),
  tableUsage: one(dataSourceTableUsage, {
    fields: [dataSources.id],
    references: [dataSourceTableUsage.dataSourceId],
  }),
}));
