/**
 * Base error class for all BlueLibs Runner errors
 */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

/**
 * Error thrown when attempting to register a component with a duplicate ID
 */
export class DuplicateRegistrationError extends RuntimeError {
  constructor(type: string, id: string) {
    super(
      `${type} "${id.toString()}" already registered. Did you use the same 'id' in two different components? Keep in mind, that all TERM elements need unique ids.`,
    );
    this.name = "DuplicateRegistrationError";
  }
}

/**
 * Error thrown when a dependency is not found in the registry
 */
export class DependencyNotFoundError extends RuntimeError {
  constructor(key: string) {
    super(
      `Dependency ${key.toString()} not found. Did you forget to register it through a resource?`,
    );
    this.name = "DependencyNotFoundError";
  }
}

/**
 * Error thrown when an unknown item type is encountered
 */
export class UnknownItemTypeError extends RuntimeError {
  constructor(item: any) {
    super(`Unknown item type: ${item}`);
    this.name = "UnknownItemTypeError";
  }
}

/**
 * Error thrown when circular dependencies are detected
 */
export class CircularDependenciesError extends RuntimeError {
  constructor(cycles: string[]) {
    const cycleDetails = cycles.map((cycle) => `  • ${cycle}`).join("\n");
    const hasMiddleware = cycles.some((cycle) => cycle.includes("middleware"));

    let guidance = "\n\nTo resolve circular dependencies:";
    guidance +=
      "\n  • Consider refactoring to reduce coupling between components";
    guidance += "\n  • Extract shared dependencies into separate resources";

    if (hasMiddleware) {
      guidance +=
        "\n  • For middleware: avoid depending on resources that use the same middleware";
      guidance +=
        "\n  • Consider using events for communication instead of direct dependencies";
    }

    super(`Circular dependencies detected:\n${cycleDetails}${guidance}`);
    this.name = "CircularDependenciesError";
  }
}

/**
 * Error thrown when an event is not found in the registry
 */
export class EventNotFoundError extends RuntimeError {
  constructor(id: string) {
    super(`Event "${id.toString()}" not found. Did you forget to register it?`);
    this.name = "EventNotFoundError";
  }
}

/**
 * Error thrown when a resource is not found in the store
 */
export class ResourceNotFoundError extends RuntimeError {
  constructor(id: string) {
    super(
      `Resource "${id.toString()}" not found. Did you forget to register it or are you using the correct id?`,
    );
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Error thrown when attempting to make a middleware global when it's already global
 */
export class MiddlewareAlreadyGlobalError extends RuntimeError {
  constructor(id: string) {
    super(
      `Cannot call .everywhere() on an already global middleware. It's enough to call everywhere() only once: ${id.toString()}`,
    );
    this.name = "MiddlewareAlreadyGlobalError";
  }
}

/**
 * Error thrown when attempting to modify a locked component
 */
export class LockedError extends RuntimeError {
  constructor(what: string) {
    super(`Cannot modify the ${what.toString()} when it is locked.`);
    this.name = "LockedError";
  }
}

/**
 * Error thrown when attempting to initialize a store that's already initialized
 */
export class StoreAlreadyInitializedError extends RuntimeError {
  constructor() {
    super("Store already initialized. Cannot reinitialize.");
    this.name = "StoreAlreadyInitializedError";
  }
}

/**
 * Error thrown when validation fails for task input, resource config, middleware config, or event payload
 */
export class ValidationError extends RuntimeError {
  constructor(type: string, id: string, originalError: Error | string) {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    super(`${type} validation failed for ${id.toString()}: ${errorMessage}`);
    this.name = "ValidationError";
  }
}
