import { TaggedError } from "better-result";

import type {
  DeviceActorFailure,
  DeviceDecisionAction,
} from "./device-auth-model";

export const GENERIC_DEVICE_VERIFY_ERROR_MESSAGE =
  "The device code could not be verified. Try again.";
export const GENERIC_DEVICE_DECISION_ERROR_MESSAGE =
  "The device request could not be completed. Try again.";

export class DeviceVerificationError extends TaggedError(
  "DeviceVerificationError"
)<{
  cause?: unknown;
  message: string;
  reason: "request_failed" | "response_failed";
}>() {}

export class DeviceDecisionError extends TaggedError("DeviceDecisionError")<{
  action: DeviceDecisionAction;
  cause?: unknown;
  message: string;
  reason: "request_failed" | "response_failed";
}>() {}

export class DeviceActorRequestError extends Error {
  constructor(input: DeviceActorFailure) {
    super(input.message);
    this.name = "DeviceActorRequestError";
  }
}
