export type BigQueryPricingModel = "on_demand" | "unknown";

const BIGQUERY_BYTES_PER_TIB = 1024n * 1024n * 1024n * 1024n;
const BIGQUERY_ON_DEMAND_PRICE_PER_TIB_MICRO_USD = 6_250_000n;
const MICRO_USD_SCALE = 1_000_000;

function divideAndRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) {
    return quotient;
  }
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function calculateBigQueryOnDemandUsd(
  bytes: bigint | null
): number | null {
  if (bytes === null) {
    return null;
  }
  const microUsd = divideAndRound(
    bytes * BIGQUERY_ON_DEMAND_PRICE_PER_TIB_MICRO_USD,
    BIGQUERY_BYTES_PER_TIB
  );
  return Number(microUsd) / MICRO_USD_SCALE;
}

export function resolveBigQueryPricingModel(
  billableBytes: bigint | null
): BigQueryPricingModel {
  return billableBytes === null ? "unknown" : "on_demand";
}
