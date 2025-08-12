import { ITask, IResource } from "./defs";

export const Errors = {
  duplicateRegistration: (type: string, id: string | symbol) =>
    new Error(`${type} "${id.toString()}" already registered`),

  dependencyNotFound: (key: string | symbol) =>
    new Error(
      `Dependency ${key.toString()} not found. Did you forget to register it through a resource?`
    ),

  unknownItemType: (item: any) => new Error(`Unknown item type: ${item}`),

  circularDependencies: (cycles: string[]) =>
    new Error(`Circular dependencies detected: ${cycles.join(", ")}`),

  eventNotFound: (id: string | symbol) =>
    new Error(
      `Event "${id.toString()}" not found. Did you forget to register it?`
    ),

  middlewareAlreadyGlobal: (id: string | symbol) =>
    new Error(
      "Cannot call .everywhere() on an already global middleware: " +
        id.toString
    ),

  locked: (what: string | symbol) =>
    new Error(`Cannot modify the ${what.toString()} when it is locked.`),

  storeAlreadyInitialized: () =>
    new Error("Store already initialized. Cannot reinitialize."),

  /**
   * Normalized validation error to surface schema failures for inputs/configs
   * while preserving the original error as cause when provided.
   */
  validationFailed: (
    kind: "task.input" | "resource.config",
    id: string | symbol,
    details?: unknown,
    cause?: unknown
  ) => {
    const err = new Error(
      `Validation failed for ${kind} of "${id.toString()}"` +
        (details ? `: ${JSON.stringify(details)}` : "")
    );
    // Attach additional context for programmatic consumers
    (err as any).kind = kind;
    (err as any).targetId = id;
    (err as any).details = details;
    if (cause) (err as any).cause = cause;
    return err;
  },
};
