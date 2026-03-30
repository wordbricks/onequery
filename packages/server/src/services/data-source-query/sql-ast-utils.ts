import type { Expr, Value } from "@casual-simulation/sql-parser";
import { isRecord } from "@onequery/base";

function getNumericValue(value: Value): number | null {
  if (value === "Null") {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const numberValue = value.Number;
  if (!Array.isArray(numberValue)) {
    return null;
  }

  const raw = numberValue[0];
  if (typeof raw !== "string") {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function getNumericValueFromExpr(expr: Expr | undefined): number | null {
  if (!expr) {
    return null;
  }

  const valueWithSpan = expr.Value;
  if (!valueWithSpan || !isRecord(valueWithSpan)) {
    return null;
  }

  return getNumericValue(valueWithSpan.value);
}
