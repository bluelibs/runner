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
 */
export type RuntimeCallSource = {
  /** Category of the admitting caller. */
  kind: RuntimeCallSourceKind;
  /**
   * Canonical runtime identifier of the admitting caller.
   */
  id: string;
};

/**
 * Factory helpers for creating runtime call-source records.
 */
export const runtimeSource = {
  /**
   * Creates a runtime-origin source record.
   *
   * @param id Canonical runtime id of the source.
   */
  runtime(id: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Runtime,
      id,
    };
  },
  /**
   * Creates a resource-origin source record.
   *
   * @param id Canonical runtime id of the source.
   */
  resource(id: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Resource,
      id,
    };
  },
  /**
   * Creates a task-origin source record.
   *
   * @param id Canonical runtime id of the source.
   */
  task(id: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Task,
      id,
    };
  },
  /**
   * Creates a hook-origin source record.
   *
   * @param id Canonical runtime id of the source.
   */
  hook(id: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Hook,
      id,
    };
  },
  /**
   * Creates a middleware-origin source record.
   *
   * @param id Canonical runtime id of the source.
   */
  middleware(id: string): RuntimeCallSource {
    return {
      kind: RuntimeCallSourceKind.Middleware,
      id,
    };
  },
} as const;
