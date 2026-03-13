/**
 * Runtime-origin categories used when tracking task and event admissions.
 */
export const RuntimeCallSourceKind = {
  Runtime: "runtime",
  Resource: "resource",
  Task: "task",
  Hook: "hook",
  Middleware: "middleware",
} as const;

/**
 * Union of every supported runtime call-source kind.
 */
export type RuntimeCallSourceKind =
  (typeof RuntimeCallSourceKind)[keyof typeof RuntimeCallSourceKind];

/**
 * Identifies the caller that admitted a task run or event emission into the runtime.
 *
 * `id` is the stable identifier most runtime APIs surface directly.
 * When Runner can resolve the exact owned definition, `path` carries the
 * canonical runtime path as well. That distinction matters when sibling definitions
 * share the same local id under different resource owners.
 */
export type RuntimeCallSource = {
  /** Category of the admitting caller. */
  kind: RuntimeCallSourceKind;
  /**
   * Stable identifier of the admitting caller.
   *
   * This is the identifier most diagnostics should surface to users.
   */
  id: string;
  /**
   * Canonical runtime path of the admitting caller when Runner can resolve it.
   *
   * Prefer this when strict runtime identity matters, because sibling definitions
   * can legitimately share the same public/local id.
   */
  path?: string;
};

/**
 * Factory helpers for creating runtime call-source records.
 */
export const runtimeSource = {
  /**
   * Creates a runtime-origin source record.
   *
   * @param id Stable display/public id of the source.
   * @param path Canonical runtime path when it differs from the display id.
   */
  runtime(id: string, path?: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Runtime,
      id,
      ...(path !== undefined ? { path } : {}),
    };
  },
  /**
   * Creates a resource-origin source record.
   *
   * @param id Stable display/public id of the source.
   * @param path Canonical runtime path when it differs from the display id.
   */
  resource(id: string, path?: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Resource,
      id,
      ...(path !== undefined ? { path } : {}),
    };
  },
  /**
   * Creates a task-origin source record.
   *
   * @param id Stable display/public id of the source.
   * @param path Canonical runtime path when it differs from the display id.
   */
  task(id: string, path?: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Task,
      id,
      ...(path !== undefined ? { path } : {}),
    };
  },
  /**
   * Creates a hook-origin source record.
   *
   * @param id Stable display/public id of the source.
   * @param path Canonical runtime path when it differs from the display id.
   */
  hook(id: string, path?: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Hook,
      id,
      ...(path !== undefined ? { path } : {}),
    };
  },
  /**
   * Creates a middleware-origin source record.
   *
   * @param id Stable display/public id of the source.
   * @param path Canonical runtime path when it differs from the display id.
   */
  middleware(id: string, path?: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Middleware,
      id,
      ...(path !== undefined ? { path } : {}),
    };
  },
} as const;
