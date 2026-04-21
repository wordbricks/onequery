const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Comment: Budget tracking launched on 2026-03-11, so pre-launch spend is
// intentionally excluded even when a longer reporting window is selected.
const BUDGET_DATA_AVAILABLE_FROM_ISO = "2026-03-11T00:00:00.000Z";

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

export function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function clampBudgetWindow(input: {
  now: Date;
  requestedWindowDays: number;
}) {
  const windowEndDay = startOfUtcDay(input.now);
  const requestedWindowStart = addUtcDays(
    windowEndDay,
    -(input.requestedWindowDays - 1)
  );
  const dataAvailableFrom = startOfUtcDay(
    new Date(BUDGET_DATA_AVAILABLE_FROM_ISO)
  );
  const windowStart =
    requestedWindowStart.getTime() > dataAvailableFrom.getTime()
      ? requestedWindowStart
      : dataAvailableFrom;

  if (windowStart.getTime() > windowEndDay.getTime()) {
    return {
      dataAvailableFrom,
      windowDays: 0,
      windowStart,
    };
  }

  return {
    dataAvailableFrom,
    windowDays:
      Math.floor(
        (windowEndDay.getTime() - windowStart.getTime()) / MILLISECONDS_PER_DAY
      ) + 1,
    windowStart,
  };
}
