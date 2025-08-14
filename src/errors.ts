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
  constructor(type: string, id: string | symbol) {
    super(`${type} "${id.toString()}" already registered`);
    this.name = "DuplicateRegistrationError";
  }
}

/**
 * Error thrown when a dependency is not found in the registry
 */
export class DependencyNotFoundError extends RuntimeError {
  constructor(key: string | symbol) {
    super(
      `Dependency ${key.toString()} not found. Did you forget to register it through a resource?`
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
    super(`Circular dependencies detected: ${cycles.join(", ")}`);
    this.name = "CircularDependenciesError";
  }
}

/**
 * Error thrown when an event is not found in the registry
 */
export class EventNotFoundError extends RuntimeError {
  constructor(id: string | symbol) {
    super(`Event "${id.toString()}" not found. Did you forget to register it?`);
    this.name = "EventNotFoundError";
  }
}

/**
 * Error thrown when attempting to make a middleware global when it's already global
 */
export class MiddlewareAlreadyGlobalError extends RuntimeError {
  constructor(id: string | symbol) {
    super(
      "Cannot call .everywhere() on an already global middleware: " +
        id.toString()
    );
    this.name = "MiddlewareAlreadyGlobalError";
  }
}

/**
 * Error thrown when attempting to modify a locked component
 */
export class LockedError extends RuntimeError {
  constructor(what: string | symbol) {
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
