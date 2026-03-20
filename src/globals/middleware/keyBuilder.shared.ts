import { validationError } from "../../errors";
import { Serializer } from "../../serializer";

/**
 * Builds a partition key for keyed middleware state.
 *
 * The first argument is the runtime canonical task id, not the local authoring
 * id from the original builder callsite.
 */
export type MiddlewareKeyBuilder = (
  canonicalTaskId: string,
  input: unknown,
) => string;

const middlewareKeySerializer = new Serializer();
const KEY_SEPARATOR = ":";

/**
 * Default partitioning uses the full storage task id so middleware can keep one
 * bucket per task lineage without depending on input serialization.
 */
export const defaultStorageTaskKeyBuilder: MiddlewareKeyBuilder = (
  canonicalTaskId,
  _input,
) => canonicalTaskId;

function serializeDefaultMiddlewareKeyInput(
  canonicalTaskId: string,
  input: unknown,
): string {
  try {
    return middlewareKeySerializer.stringify(input);
  } catch (error) {
    const originalError =
      error instanceof Error ? error.message : String(error);

    return validationError.throw({
      subject: "Middleware config",
      id: canonicalTaskId,
      originalError:
        "Default keyed middleware partitioning requires serializable input. " +
        "Provide keyBuilder(canonicalTaskId, input) when inputs include " +
        "functions, circular structures, or other non-serializable values. " +
        originalError,
    });
  }
}

/**
 * Default partitioning uses the task id plus serialized input so unrelated
 * payloads do not silently collapse into the same middleware bucket.
 */
export const defaultTaskKeyBuilder: MiddlewareKeyBuilder = (
  canonicalTaskId,
  input,
) =>
  `${canonicalTaskId}${KEY_SEPARATOR}${serializeDefaultMiddlewareKeyInput(canonicalTaskId, input)}`;
