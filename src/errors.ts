/**
 * Built-in framework error helpers and runtime error ids.
 */
export * from "./errors/foundation.errors";
export * from "./errors/model-runtime.errors";
export * from "./errors/domain-error-ids";
export * from "./errors/domain-runtime.errors";
export * from "./errors/generic.errors";

/**
 * Shared public types for Runner error helpers.
 */
export type { AnyError, IErrorHelper } from "./types/error";
