import type { Context, Env, ValidationTargets } from "hono";
import { zodProblemHook as createProblemDetailsZodHook } from "hono-problem-details/zod";
import type { ZodProblemHookOptions } from "hono-problem-details/zod";
import type * as v3 from "zod/v3";
import type * as v4 from "zod/v4/core";

type AnyZodSchema = v3.ZodType | v4.$ZodType;
type ZodValidatorError<Schema extends AnyZodSchema> = Schema extends v4.$ZodType
  ? v4.$ZodError<v4.output<Schema>>
  : v3.ZodError;

type CompatibleZodHook<
  T,
  E extends Env,
  P extends string,
  Target extends keyof ValidationTargets,
  Schema extends AnyZodSchema,
> = (
  result:
    | {
        success: true;
        data: T;
        target: Target;
      }
    | {
        success: false;
        data: T;
        error: ZodValidatorError<Schema>;
        target: Target;
      },
  c: Context<E, P>
) => Response | void | Promise<Response | void>;

export type { ZodProblemHookOptions } from "hono-problem-details/zod";

export function zodProblemHook<
  T,
  E extends Env,
  P extends string,
  Target extends keyof ValidationTargets = keyof ValidationTargets,
  Schema extends AnyZodSchema = AnyZodSchema,
>(options?: ZodProblemHookOptions): CompatibleZodHook<T, E, P, Target, Schema> {
  const hook = createProblemDetailsZodHook(options);

  return (result, c) =>
    // Comment: hono-problem-details@0.4.0 handles the Zod v4 runtime shape,
    // but its hook type still narrows `error` to `ZodError` instead of the
    // broader `$ZodError` that @hono/zod-validator exposes for v4 schemas.
    hook(result as Parameters<typeof hook>[0], c as Context);
}
