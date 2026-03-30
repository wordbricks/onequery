import { createMiddleware } from "hono/factory";

import type { CliRouteEnv } from "./app";
import type { CliApiErrorStage } from "./domain/problems";
import { throwCliProblem } from "./error";
import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
  parseSelectedFields,
} from "./read-controls-policy";
import type {
  CliFieldsReadControls,
  CliPaginatedReadControls,
} from "./read-controls-policy";
import type { CliValidationHookConfig } from "./validation";

export type {
  CliFieldsReadControls,
  CliPage,
  CliPaginatedReadControls,
  CliSelectedFields,
} from "./read-controls-policy";

type CliReadControlsValidatorConfig = CliValidationHookConfig & {
  allowedFields: readonly string[];
};

type CliFieldsQuery = {
  fields?: string;
};

type CliPaginatedReadQuery = CliFieldsQuery & {
  limit?: number;
  cursor?: string;
};

type CliFieldsReadControlsInput = {
  out: {
    query: CliFieldsQuery;
  };
};

type CliPaginatedReadControlsInput = {
  out: {
    query: CliPaginatedReadQuery;
  };
};

export function createCliFieldsReadControlsMiddleware(
  config: CliReadControlsValidatorConfig
) {
  return createMiddleware<
    CliRouteEnv<{ readControls: CliFieldsReadControls }>,
    string,
    CliFieldsReadControlsInput
  >(async (c, next) => {
    const query = c.req.valid("query");
    const selectedFields = parseSelectedFields(
      query.fields,
      config.allowedFields
    );

    if (!selectedFields.ok) {
      throwReadControlsProblem({
        detail: selectedFields.message,
        field: "fields",
        hint: config.hint,
        stage: resolveReadControlsStage(config, "fields"),
      });
    }

    c.set("readControls", {
      selectedFields: selectedFields.value,
    });
    await next();
  });
}

export function createCliPaginatedReadControlsMiddleware(
  config: CliReadControlsValidatorConfig
) {
  return createMiddleware<
    CliRouteEnv<{ readControls: CliPaginatedReadControls }>,
    string,
    CliPaginatedReadControlsInput
  >(async (c, next) => {
    const query = c.req.valid("query");
    const selectedFields = parseSelectedFields(
      query.fields,
      config.allowedFields
    );

    if (!selectedFields.ok) {
      throwReadControlsProblem({
        detail: selectedFields.message,
        field: "fields",
        hint: config.hint,
        stage: resolveReadControlsStage(config, "fields"),
      });
    }

    const offset = parsePageCursor(query.cursor);
    if (!offset.ok) {
      throwReadControlsProblem({
        detail: offset.message,
        field: "cursor",
        hint: config.hint,
        stage: resolveReadControlsStage(config, "cursor"),
      });
    }

    c.set("readControls", {
      limit: query.limit ?? CLI_DEFAULT_PAGE_LIMIT,
      offset: offset.value,
      selectedFields: selectedFields.value,
    });
    await next();
  });
}

function resolveReadControlsStage(
  config: CliReadControlsValidatorConfig,
  field: string
): CliApiErrorStage {
  return config.fieldStages?.[field] ?? config.defaultStage;
}

function throwReadControlsProblem(input: {
  field: string;
  stage: CliApiErrorStage;
  hint: string;
  detail: string;
}): never {
  throwCliProblem({
    detail: input.detail,
    errors: [
      {
        field: input.field,
        message: input.detail,
        code: "invalid",
      },
    ],
    hint: input.hint,
    key: "INVALID_REQUEST",
    stage: input.stage,
  });
}
