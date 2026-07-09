import type { IErrorHelper } from "../types/error";
import type { TagTargetViolation } from "./definitionValidation";

let tagTargetNotAllowedError: IErrorHelper<TagTargetViolation> | undefined;

export function registerTagTargetNotAllowedError(
  error: IErrorHelper<TagTargetViolation>,
): void {
  tagTargetNotAllowedError = error;
}

export function getTagTargetNotAllowedError():
  | IErrorHelper<TagTargetViolation>
  | undefined {
  return tagTargetNotAllowedError;
}
