import { create } from "@bufbuild/protobuf";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import * as sourceApiPb from "../../../connect/gen/onequery/workflow/v1/source_api_action_pb";
import type { WorkflowStorageCorruptRowError } from "../../storage/errors";
import {
  assertNever,
  convertWorkflowPayload,
  decodeWorkflowPayload,
  encodeWorkflowPayload,
} from "../../storage/protobuf-codec";
import type { SourceApiActionEffect } from "../effects";
import { assertMatchingPayloadType } from "./shared";
import type { SourceApiPayloadDecodeContext } from "./shared";
import {
  fromSourceApiRequestDescriptorMessage,
  fromSourceApiSourceDescriptorMessage,
  toSourceApiRequestDescriptorMessage,
  toSourceApiSourceDescriptorMessage,
} from "./source-api-value-codec";

export function encodeSourceApiActionEffectPayload(
  effect: SourceApiActionEffect
): Buffer {
  return encodeWorkflowPayload(
    sourceApiPb.SourceApiActionEffectPayloadSchema,
    toSourceApiActionEffectMessage(effect)
  );
}

export function decodeSourceApiActionEffectPayload(
  bytes: Buffer,
  context: SourceApiPayloadDecodeContext
): ResultType<SourceApiActionEffect, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(
    sourceApiPb.SourceApiActionEffectPayloadSchema,
    bytes,
    {
      ...context,
      entity: "source_api_action_effect_payload",
      family: "source_api_action",
    }
  );
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "source_api_action_effect_payload",
      family: "source_api_action",
    },
    () => {
      const effect = fromSourceApiActionEffectMessage(decoded.value);
      assertMatchingPayloadType(context.payloadType, effect.type);
      return effect;
    }
  );
}

function toSourceApiActionEffectMessage(effect: SourceApiActionEffect) {
  switch (effect.type) {
    case "load_source":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "loadSource",
          value: create(sourceApiPb.SourceApiActionLoadSourceEffectSchema, {
            organizationId: effect.organizationId,
            sourceKey: effect.sourceKey,
          }),
        },
      });
    case "resolve_descriptor":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "resolveDescriptor",
          value: create(
            sourceApiPb.SourceApiActionResolveDescriptorEffectSchema,
            {
              source: toSourceApiSourceDescriptorMessage(effect.source),
            }
          ),
        },
      });
    case "prepare_request":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "prepareRequest",
          value: create(sourceApiPb.SourceApiActionPrepareRequestEffectSchema, {
            requestDescriptor: toSourceApiRequestDescriptorMessage(
              effect.requestDescriptor
            ),
            source: toSourceApiSourceDescriptorMessage(effect.source),
          }),
        },
      });
    case "execute_page":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "executePage",
          value: create(sourceApiPb.SourceApiActionExecutePageEffectSchema, {
            attemptNumber: effect.attemptNumber,
            pageIndex: effect.pageIndex,
            preparedRequestFingerprint: effect.preparedRequestFingerprint,
            requestDescriptor: toSourceApiRequestDescriptorMessage(
              effect.requestDescriptor
            ),
            source: toSourceApiSourceDescriptorMessage(effect.source),
          }),
        },
      });
    default:
      return assertNever(effect);
  }
}

function fromSourceApiActionEffectMessage(
  payload: sourceApiPb.SourceApiActionEffectPayload
): SourceApiActionEffect {
  switch (payload.effect.case) {
    case "loadSource":
      return {
        organizationId: payload.effect.value.organizationId,
        sourceKey: payload.effect.value.sourceKey,
        type: "load_source",
      };
    case "resolveDescriptor":
      return {
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "resolve_descriptor",
      };
    case "prepareRequest":
      return {
        requestDescriptor: fromSourceApiRequestDescriptorMessage(
          payload.effect.value.requestDescriptor
        ),
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "prepare_request",
      };
    case "executePage":
      return {
        attemptNumber: payload.effect.value.attemptNumber,
        pageIndex: payload.effect.value.pageIndex,
        preparedRequestFingerprint:
          payload.effect.value.preparedRequestFingerprint,
        requestDescriptor: fromSourceApiRequestDescriptorMessage(
          payload.effect.value.requestDescriptor
        ),
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "execute_page",
      };
    case undefined:
      throw new Error("source api action effect payload missing oneof case");
    default:
      return assertNever(payload.effect);
  }
}
