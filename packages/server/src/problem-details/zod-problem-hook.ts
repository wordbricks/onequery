import type { Hook } from "@hono/zod-validator";
import type { Context, Env, ValidationTargets } from "hono";
import { zodProblemHook as createProblemDetailsZodHook } from "hono-problem-details/zod";
import type { ZodProblemHookOptions } from "hono-problem-details/zod";
import type * as v3 from "zod/v3";
import type * as v4 from "zod/v4/core";

type AnyZodSchema = v3.ZodType | v4.$ZodType;

export type { ZodProblemHookOptions } from "hono-problem-details/zod";

export function zodProblemHook<
  T,
  E extends Env,
  P extends string,
  Target extends keyof ValidationTargets = keyof ValidationTargets,
  Schema extends AnyZodSchema = AnyZodSchema,
>(
  options?: ZodProblemHookOptions
): Hook<T, E, P, Target, Record<never, never>, Schema> {
  const hook = createProblemDetailsZodHook(options);

  return ((result, c) =>
    // Comment: hono-problem-details@0.4.0 handles the Zod v4 runtime shape,
    // but its hook type still narrows `error` to `ZodError` instead of the
    // broader `$ZodError` that @hono/zod-validator exposes for v4 schemas.
    hook(result as Parameters<typeof hook>[0], c as Context)) as Hook<
    T,
    E,
    P,
    Target,
    Record<never, never>,
    Schema
  >;
}
