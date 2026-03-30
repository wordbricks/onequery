const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: "currency",
});

const integerFormatter = new Intl.NumberFormat("en-US");

type ParsedBudgetInput = number | null | "invalid";

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatCount(value: number): string {
  return integerFormatter.format(value);
}

export function formatBudgetInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function sanitizeBudgetInput(value: string): string {
  const normalized = value.replaceAll(/[^0-9.]/g, "");
  const [wholePart = "", ...fractionParts] = normalized.split(".");

  if (fractionParts.length === 0) {
    return wholePart;
  }

  return `${wholePart}.${fractionParts.join("").slice(0, 2)}`;
}

export function parseBudgetInput(value: string): ParsedBudgetInput {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  if (!/^\d+(\.\d{0,2})?$/.test(trimmedValue)) {
    return "invalid";
  }

  const parsedValue = Number(trimmedValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return "invalid";
  }

  return parsedValue;
}

function toBudgetComparisonValue(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 100);
}

export function getBudgetSaveDisabled(input: {
  parsedBudgetInput: ParsedBudgetInput;
  currentBudgetUsd: number | null;
  isPending: boolean;
}): boolean {
  if (input.isPending || input.parsedBudgetInput === "invalid") {
    return true;
  }

  return (
    toBudgetComparisonValue(input.parsedBudgetInput) ===
    toBudgetComparisonValue(input.currentBudgetUsd)
  );
}

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatDateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

export function formatSharePercent(value: number): string {
  if (value <= 0) {
    return "0%";
  }
  if (value < 10) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

export function buildSvgPath(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${point.x},${point.y}`;
    })
    .join(" ");
}
