export { check, Match } from "./check/engine";
export type { CheckOptions } from "./check/engine";
export type {
  CheckSchemaLike,
  CheckedValue,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchMessageContext,
  MatchMessageOptions,
  MatchJsonObject,
  MatchJsonPrimitive,
  MatchJsonSchema,
  MatchJsonValue,
  MatchSchemaDecorator,
  MatchSchemaOptions,
  MatchClassDecorator,
  MatchClassOptions,
  MatchPropertyDecorator,
  MatchPattern,
  MatchToJsonSchemaOptions,
} from "./check/types";
export {
  CheckJsonSchemaPatternError,
  CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID,
  CheckOptionsError,
  MatchError,
  MatchPatternError,
  type MatchFailure,
  CHECK_ERROR_ID,
  CHECK_INVALID_OPTIONS_ERROR_ID,
  CHECK_INVALID_PATTERN_ERROR_ID,
} from "./check/errors";
