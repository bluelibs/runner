import { Match } from "./check/engine";
import { hasClassSchemaMetadata } from "./check/classSchema";
import { registerCheckRuntime } from "./check/runtime";

registerCheckRuntime({
  Match,
  hasClassSchemaMetadata,
});

export { check, Match } from "./check/engine";
export type { CheckOptions } from "./check/engine";
export type {
  CheckSchemaLike,
  CheckedValue,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchMessageContext,
  MatchMessageDescriptor,
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
  CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID,
  type MatchFailure,
  MATCH_ERROR_ID,
  CHECK_INVALID_OPTIONS_ERROR_ID,
  CHECK_INVALID_PATTERN_ERROR_ID,
  isMatchError,
} from "./check/errors";
