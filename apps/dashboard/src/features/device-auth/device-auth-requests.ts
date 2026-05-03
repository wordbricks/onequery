import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import type { InferResponseType } from "hono/client";

import { createApiClient } from "@/lib/api-client";

import type {
  DeviceDecisionAction,
  DeviceResultTone,
  DeviceDecisionRequest,
  DeviceVerificationRequest,
} from "./device-auth-model";
import {
  DeviceActorRequestError,
  DeviceDecisionError,
  DeviceVerificationError,
  GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
  GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
} from "./errors";

type DeviceClient = ReturnType<typeof createApiClient>;
type VerifyDeviceGet = DeviceClient["api"]["device"]["verify"]["$get"];
type VerifyDeviceSuccessResponse = InferResponseType<VerifyDeviceGet, 200>;
type VerifyDeviceResponse = InferResponseType<VerifyDeviceGet>;
type SubmitDeviceDecisionSuccessResponse = InferResponseType<
  DeviceClient["api"]["device"]["approve"]["$post"],
  200
>;
type SubmitDeviceDecisionResponse = InferResponseType<
  DeviceClient["api"]["device"]["approve"]["$post"]
>;

type VerifyDeviceRequestResult = ResultType<
  {
    status: "pending" | "approved" | "denied";
    userCode: string;
  },
  DeviceVerificationError
>;

type SubmitDecisionRequestResult = ResultType<
  {
    title: string;
    message: string;
    tone: DeviceResultTone;
  },
  DeviceDecisionError
>;

export type VerifyDeviceActorInput = DeviceVerificationRequest;
export type VerifyDeviceActorOutput = {
  status: "pending" | "approved" | "denied";
  userCode: string;
};

export type SubmitDeviceDecisionActorInput = DeviceDecisionRequest;
export type SubmitDeviceDecisionActorOutput = {
  title: string;
  message: string;
  tone: DeviceResultTone;
};

export async function verifyDeviceRequest(
  userCode: string,
  options: { signal?: AbortSignal } = {}
): Promise<VerifyDeviceRequestResult> {
  const deviceClient = createApiClient();

  const responseResult = await Result.tryPromise({
    try: () =>
      deviceClient.api.device.verify.$get(
        {
          query: {
            user_code: userCode,
          },
        },
        {
          init: {
            signal: options.signal,
          },
        }
      ),
    catch: (cause: unknown) =>
      new DeviceVerificationError({
        cause,
        message: GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
        reason: "request_failed",
      }),
  });
  if (responseResult.isErr()) {
    console.error("[device-auth] failed to verify device code", {
      errorName: readErrorName(responseResult.error.cause),
    });
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;

  if (!response.ok) {
    const payload =
      await readResponseJsonOrNull<VerifyDeviceResponse>(response);
    return Result.err(
      new DeviceVerificationError({
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_VERIFY_ERROR_MESSAGE
        ),
        reason: "response_failed",
      })
    );
  }

  const payload =
    await readResponseJsonOrNull<VerifyDeviceSuccessResponse>(response);
  if (payload === null) {
    console.error("[device-auth] failed to parse verify device response");
    return Result.err(
      new DeviceVerificationError({
        message: GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
        reason: "response_failed",
      })
    );
  }

  return Result.ok({
    status: payload.status,
    userCode: payload.userCode,
  });
}

export async function submitDeviceDecisionRequest(input: {
  action: DeviceDecisionAction;
  signal?: AbortSignal;
  userCode: string;
}): Promise<SubmitDecisionRequestResult> {
  const deviceClient = createApiClient();

  const userCode = input.userCode;

  const submitDecision =
    input.action === "approve"
      ? deviceClient.api.device.approve.$post
      : deviceClient.api.device.deny.$post;
  const responseResult = await Result.tryPromise({
    try: () =>
      submitDecision(
        {
          form: {
            user_code: userCode,
          },
        },
        {
          init: {
            signal: input.signal,
          },
        }
      ),
    catch: (cause: unknown) =>
      new DeviceDecisionError({
        action: input.action,
        cause,
        message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
        reason: "request_failed",
      }),
  });
  if (responseResult.isErr()) {
    console.error("[device-auth] failed to submit device decision", {
      action: input.action,
      errorName: readErrorName(responseResult.error.cause),
    });
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;

  if (!response.ok) {
    const payload =
      await readResponseJsonOrNull<SubmitDeviceDecisionResponse>(response);
    return Result.err(
      new DeviceDecisionError({
        action: input.action,
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_DECISION_ERROR_MESSAGE
        ),
        reason: "response_failed",
      })
    );
  }

  const payload =
    await readResponseJsonOrNull<SubmitDeviceDecisionSuccessResponse>(response);
  if (payload === null) {
    console.error("[device-auth] failed to parse device decision response", {
      action: input.action,
    });
    return Result.err(
      new DeviceDecisionError({
        action: input.action,
        message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
        reason: "response_failed",
      })
    );
  }

  return Result.ok({
    message: payload.message,
    title: payload.title,
    tone: input.action === "approve" ? "success" : "error",
  });
}

export async function verifyDeviceActorRequest(
  input: VerifyDeviceActorInput,
  options: { signal?: AbortSignal } = {}
): Promise<VerifyDeviceActorOutput> {
  const result = await verifyDeviceRequest(input.userCode, options);

  if (result.isErr()) {
    throw new DeviceActorRequestError({
      message: result.error.message,
    });
  }

  return {
    status: result.value.status,
    userCode: result.value.userCode,
  };
}

export async function submitDeviceDecisionActorRequest(
  input: SubmitDeviceDecisionActorInput,
  options: { signal?: AbortSignal } = {}
): Promise<SubmitDeviceDecisionActorOutput> {
  const result = await submitDeviceDecisionRequest({
    action: input.action,
    signal: options.signal,
    userCode: input.userCode,
  });

  if (result.isErr()) {
    throw new DeviceActorRequestError({
      message: result.error.message,
    });
  }

  return {
    message: result.value.message,
    title: result.value.title,
    tone: result.value.tone,
  };
}

async function readResponseJsonOrNull<T>(
  response: Response
): Promise<T | null> {
  const payloadResult = await Result.tryPromise(
    () => response.json() as Promise<T>
  );
  return payloadResult.isErr() ? null : payloadResult.value;
}

function readDeviceErrorMessage(
  payload: VerifyDeviceResponse | SubmitDeviceDecisionResponse | null,
  fallback: string
) {
  if (!payload) {
    return fallback;
  }

  // Comment: device auth errors can originate from server-side auth checks, so
  // keep browser-visible failures generic instead of forwarding raw payload
  // strings that may expose internal auth or validation details.
  return "error" in payload ? fallback : fallback;
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}
