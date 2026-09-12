/**
 * Runtime-origin categories used when tracking task and event admissions.
 */
export const RuntimeCallSourceKind = Object.freeze({
  Runtime: "runtime",
  Resource: "resource",
  Task: "task",
  Hook: "hook",
  TaskMiddleware: "task-middleware",
  ResourceMiddleware: "resource-middleware",
} as const);

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
  readonly kind: RuntimeCallSourceKind;
  /** Canonical definition id or stable runtime-origin id of the admitting caller. */
  readonly id: string;
};

/**
 * Factory helpers for creating runtime call-source records.
 */
export const runtimeSource = Object.freeze({
  /**
   * Creates a runtime-origin source record.
   *
   * @param id Stable runtime-origin id of the source.
   */
  runtime(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.Runtime,
      id,
    });
  },
  /**
   * Creates a resource-origin source record.
   *
   * @param id Canonical resource id of the source.
   */
  resource(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.Resource,
      id,
    });
  },
  /**
   * Creates a task-origin source record.
   *
   * @param id Canonical task id of the source.
   */
  task(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.Task,
      id,
    });
  },
  /**
   * Creates a hook-origin source record.
   *
   * @param id Canonical hook id of the source.
   */
  hook(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.Hook,
      id,
    });
  },
  /** Creates a task-middleware source using its canonical definition id. */
  taskMiddleware(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.TaskMiddleware,
      id,
    });
  },
  /**
   * Creates a resource-middleware-origin source record.
   *
   * @param id Canonical resource middleware id of the source.
   */
  resourceMiddleware(id: string): RuntimeCallSource {
    return Object.freeze({
      kind: RuntimeCallSourceKind.ResourceMiddleware,
      id,
    });
  },
} as const);
