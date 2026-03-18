import { validationError } from "../../errors";
import { Serializer } from "../../serializer";

/**
 * Helper values injected into keyed middleware key builders.
 */
export interface MiddlewareKeyBuilderHelpers {
  /**
   * Canonical task key without the serialized-input suffix.
   *
   * This preserves the full canonical task lineage so keyed middleware does not
   * accidentally share state across sibling resources that reuse the same local
   * task id.
   */
  canonicalKey: string;
}

/**
 * Builds a partition key for keyed middleware state.
 */
export type MiddlewareKeyBuilder = (
  taskId: string,
  input: unknown,
  helpers?: MiddlewareKeyBuilderHelpers,
) => string;

const middlewareKeySerializer = new Serializer();
const KEY_SEPARATOR = ":";

export function toCanonicalTaskKey(taskId: string): string {
  return taskId;
}

export function createMiddlewareKeyBuilderHelpers(
  taskId: string,
): MiddlewareKeyBuilderHelpers {
  return {
    canonicalKey: toCanonicalTaskKey(taskId),
  };
}

function serializeDefaultMiddlewareKeyInput(
  taskId: string,
  input: unknown,
): string {
  try {
    return middlewareKeySerializer.stringify(input);
  } catch (error) {
    const originalError =
      error instanceof Error ? error.message : String(error);

    return validationError.throw({
      subject: "Middleware config",
      id: taskId,
      originalError:
        "Default keyed middleware partitioning requires serializable input. " +
        "Provide keyBuilder(taskId, input) when inputs include functions, " +
        "circular structures, or other non-serializable values. " +
        originalError,
    });
  }
}

/**
 * Default partitioning uses the task id plus serialized input so unrelated
 * payloads do not silently collapse into the same middleware bucket.
 */
export const defaultTaskKeyBuilder: MiddlewareKeyBuilder = (
  taskId,
  input,
  helpers,
) =>
  `${
    helpers?.canonicalKey ?? toCanonicalTaskKey(taskId)
  }${KEY_SEPARATOR}${serializeDefaultMiddlewareKeyInput(taskId, input)}`;
