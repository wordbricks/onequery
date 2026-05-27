export type AthenaPricingModel = "per_tb_scanned" | "unknown";

const ATHENA_BYTES_PER_TIB = 1024n * 1024n * 1024n * 1024n;
const ATHENA_PRICE_PER_TIB_MICRO_USD = 5_000_000n;
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

export function calculateAthenaUsd(bytes: bigint | null): number | null {
  if (bytes === null) {
    return null;
  }
  const microUsd = divideAndRound(
    bytes * ATHENA_PRICE_PER_TIB_MICRO_USD,
    ATHENA_BYTES_PER_TIB
  );
  return Number(microUsd) / MICRO_USD_SCALE;
}

export function resolveAthenaPricingModel(
  billableBytes: bigint | null
): AthenaPricingModel {
  return billableBytes === null ? "unknown" : "per_tb_scanned";
}
