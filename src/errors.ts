import { detectEnvironment } from "./platform";

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
      `${type} "${id.toString()}" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.`,
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
    super(
      `Unknown item type: ${item}. Please ensure you are not using different versions of '@bluelibs/runner'`,
    );
    this.name = "UnknownItemTypeError";
  }
}

/**
 * Error thrown whenever a requested context is not available.
 */
export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextError";
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
        "\n  • For middleware: you can filter out tasks/resources using everywhere(fn)";
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

export class MiddlewareNotRegisteredError extends RuntimeError {
  constructor(type: "task" | "resource", source: string, middlewareId: string) {
    super(
      `Middleware inside ${type} "${source}" depends on "${middlewareId}" but it's not registered. Did you forget to register it?`,
    );

    this.name = `MiddlewareNotRegisteredError: ${type} ${source} ${middlewareId}`;
  }
}

/**
 * Error thrown when a tag is not found in the registry
 */
export class TagNotFoundError extends RuntimeError {
  constructor(id: string) {
    super(
      `Tag "${id}" not registered. Did you forget to register it inside a resource?`,
    );
    this.name = "TagNotRegisteredError";
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

/**
 * Error thrown when an event emission cycle is detected
 */
export class EventCycleError extends RuntimeError {
  constructor(path: Array<{ id: string; source: string }>) {
    const chain = path.map((p) => `${p.id}←${p.source}`).join("  ->  ");
    super(
      `Event emission cycle detected:\n  ${chain}\n\nBreak the cycle by changing hook logic (avoid mutual emits) or gate with conditions/tags.`,
    );
    this.name = "EventCycleError";
  }
}

/**
 * Error thrown when a compile-time event emission cycle is detected
 */
export class EventEmissionCycleError extends RuntimeError {
  constructor(cycles: string[]) {
    const list = cycles.map((c) => `  • ${c}`).join("\n");
    super(
      `Event emission cycles detected between hooks and events:\n${list}\n\nThis was detected at compile time (dry-run). Break the cycle by avoiding mutual emits between hooks or scoping hooks using tags.`,
    );
    this.name = "EventEmissionCycleError";
  }
}

/**
 * Error thrown when a platform function is not supported in the current environment.
 */
export class PlatformUnsupportedFunction extends RuntimeError {
  constructor(functionName: string) {
    super(
      `Platform function not supported in this environment: ${functionName}. Detected platform: ${detectEnvironment()}.`,
    );
    this.name = "PlatformUnsupportedFunction";
  }
}
