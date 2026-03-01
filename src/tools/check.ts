export { check, Match } from "./check/engine";
export type { CheckOptions } from "./check/engine";
export type {
  CheckedValue,
  InferMatchPattern,
  MatchPattern,
} from "./check/types";
export {
  MatchError,
  type MatchFailure,
  CHECK_ERROR_ID,
  CHECK_INVALID_OPTIONS_ERROR_ID,
  CHECK_INVALID_PATTERN_ERROR_ID,
} from "./check/errors";
