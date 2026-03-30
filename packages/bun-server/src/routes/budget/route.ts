import { zValidator } from "@hono/zod-validator";
import {
  and,
  count,
  dataSourceQueryCosts,
  desc,
  eq,
  gte,
  sql,
} from "@onequery/db/server";
import type { ServerEnv } from "@onequery/server/env";
import { requireOrgAccess } from "@onequery/server/middleware/require-org-access";
import type { SessionVariables } from "@onequery/server/middleware/session";
import { zodProblemHook } from "@onequery/server/problem-details/zod-problem-hook";
import { Hono } from "hono";
import { z } from "zod";

import { clampBudgetWindow } from "./availability";

const BudgetDashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  organizationId: z.string().min(1, "organizationId is required"),
});

type DailyCostAggregateRow = {
  date: string;
  totalCostUsd: number | string | null;
  queryCount: number | string;
  totalDataVolumeBytes: string | null;
};

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toText(value: string | null | undefined): string {
  return value ?? "0";
}

function buildDailyCostSeries(input: {
  rangeStart: Date;
  windowDays: number;
  rows: DailyCostAggregateRow[];
}) {
  const dailyMap = new Map(
    input.rows.map((row) => [
      row.date,
      {
        queryCount: toNumber(row.queryCount),
        totalCostUsd: toNumber(row.totalCostUsd),
        totalDataVolumeBytes: toText(row.totalDataVolumeBytes),
      },
    ])
  );

  return Array.from({ length: input.windowDays }, (_, index) => {
    const date = addUtcDays(input.rangeStart, index);
    const key = toDayKey(date);
    const value = dailyMap.get(key);
    return {
      date: key,
      queryCount: value?.queryCount ?? 0,
      totalCostUsd: value?.totalCostUsd ?? 0,
      totalDataVolumeBytes: value?.totalDataVolumeBytes ?? "0",
    };
  });
}

export const budgetRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().get(
  "/",
  requireOrgAccess(),
  zValidator("query", BudgetDashboardQuerySchema, zodProblemHook()),
  async (c) => {
    const { organizationId, days } = c.req.valid("query");
    const now = new Date();
    const requestedWindowDays = days ?? 30;
    const { dataAvailableFrom, windowDays, windowStart } = clampBudgetWindow({
      now,
      requestedWindowDays,
    });
    const db = c.var.storage.db;
    const whereClause = and(
      eq(dataSourceQueryCosts.organizationId, organizationId),
      gte(dataSourceQueryCosts.executedAt, windowStart)
    );

    // Comment: `data_source_query_costs` records observed query spend, but the
    // app does not yet persist org-level budget targets. This endpoint therefore
    // exposes usage and cost rollups rather than budget-versus-limit data.
    // Comment: Budget tracking launched on 2026-03-11, so pre-launch spend is
    // intentionally excluded even when a longer reporting window is selected.
    const [overviewRows, providerRows, connectionRows, dailyRows] =
      await Promise.all([
        db
          .select({
            activeConnectionCount: sql<number>`
							count(distinct ${dataSourceQueryCosts.connectionName})
						`,
            activeProviderCount: sql<number>`
							count(distinct ${dataSourceQueryCosts.provider})
						`,
            queryCount: count(),
            totalCostUsd: sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`,
            totalDataVolumeBytes: sql<string>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.billableBytes},
										${dataSourceQueryCosts.actualProcessedBytes},
										${dataSourceQueryCosts.estimatedProcessedBytes},
										0
									)
								),
								0
							)::text
						`,
          })
          .from(dataSourceQueryCosts)
          .where(whereClause),
        db
          .select({
            provider: dataSourceQueryCosts.provider,
            queryCount: count(),
            totalCostUsd: sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`,
            totalDataVolumeBytes: sql<string>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.billableBytes},
										${dataSourceQueryCosts.actualProcessedBytes},
										${dataSourceQueryCosts.estimatedProcessedBytes},
										0
									)
								),
								0
							)::text
						`,
          })
          .from(dataSourceQueryCosts)
          .where(whereClause)
          .groupBy(dataSourceQueryCosts.provider)
          .orderBy(
            desc(sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`)
          ),
        db
          .select({
            connectionName: dataSourceQueryCosts.connectionName,
            provider: dataSourceQueryCosts.provider,
            queryCount: count(),
            totalCostUsd: sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`,
            totalDataVolumeBytes: sql<string>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.billableBytes},
										${dataSourceQueryCosts.actualProcessedBytes},
										${dataSourceQueryCosts.estimatedProcessedBytes},
										0
									)
								),
								0
							)::text
						`,
          })
          .from(dataSourceQueryCosts)
          .where(whereClause)
          .groupBy(
            dataSourceQueryCosts.connectionName,
            dataSourceQueryCosts.provider
          )
          .orderBy(
            desc(sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`),
            desc(
              sql<Date | string | null>`max(${dataSourceQueryCosts.executedAt})`
            )
          )
          .limit(8),
        db
          .select({
            date: sql<string>`
							date_trunc('day', ${dataSourceQueryCosts.executedAt})::date::text
						`,
            queryCount: count(),
            totalCostUsd: sql<number>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.actualCostUsd},
										${dataSourceQueryCosts.estimatedCostUsd},
										0
									)
								),
								0
							)
						`,
            totalDataVolumeBytes: sql<string>`
							coalesce(
								sum(
									coalesce(
										${dataSourceQueryCosts.billableBytes},
										${dataSourceQueryCosts.actualProcessedBytes},
										${dataSourceQueryCosts.estimatedProcessedBytes},
										0
									)
								),
								0
							)::text
						`,
          })
          .from(dataSourceQueryCosts)
          .where(whereClause)
          .groupBy(
            sql<string>`
							date_trunc('day', ${dataSourceQueryCosts.executedAt})::date::text
						`
          )
          .orderBy(
            sql<string>`
							date_trunc('day', ${dataSourceQueryCosts.executedAt})::date::text
						`
          ),
      ]);

    const overview = overviewRows[0] ?? {
      activeConnectionCount: 0,
      activeProviderCount: 0,
      queryCount: 0,
      totalCostUsd: 0,
      totalDataVolumeBytes: "0",
    };
    const queryCount = toNumber(overview.queryCount);

    return c.json({
      connectionBreakdown: connectionRows.map((row) => ({
        connectionName: row.connectionName,
        provider: row.provider,
        totalCostUsd: toNumber(row.totalCostUsd),
        queryCount: toNumber(row.queryCount),
        totalDataVolumeBytes: toText(row.totalDataVolumeBytes),
      })),
      dailyCost: buildDailyCostSeries({
        rangeStart: windowStart,
        rows: dailyRows,
        windowDays,
      }),
      dataAvailableFrom: dataAvailableFrom.toISOString(),
      generatedAt: now.toISOString(),
      overview: {
        totalCostUsd: toNumber(overview.totalCostUsd),
        queryCount,
        totalDataVolumeBytes: toText(overview.totalDataVolumeBytes),
        activeConnectionCount: toNumber(overview.activeConnectionCount),
        activeProviderCount: toNumber(overview.activeProviderCount),
        averageCostPerQueryUsd:
          queryCount > 0 ? toNumber(overview.totalCostUsd) / queryCount : 0,
      },
      providerBreakdown: providerRows.map((row) => ({
        provider: row.provider,
        totalCostUsd: toNumber(row.totalCostUsd),
        queryCount: toNumber(row.queryCount),
        totalDataVolumeBytes: toText(row.totalDataVolumeBytes),
      })),
      requestedWindowDays,
      windowDays,
      windowEnd: now.toISOString(),
      windowStart: windowStart.toISOString(),
    });
  }
);
