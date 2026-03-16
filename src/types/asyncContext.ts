import { symbolAsyncContext, symbolFilePath } from "./symbols";
import { ITaskMiddlewareConfigured } from "./taskMiddleware";
import type {
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import type { IAsyncContextMeta } from "./meta";

/**
 * Definition contract for creating an async context.
 *
 * This is the object form consumed by `defineAsyncContext(...)`.
 */
export interface IAsyncContextDefinition<T> {
  /**
   * Stable context id used for registration, lookup, and serialization envelopes.
   */
  id: string;
  /**
   * Custom serializer for transporting the context across process or network boundaries.
   */
  serialize?(data: T): string;
  /**
   * Custom parser paired with {@link serialize}.
   */
  parse?(data: string): T;
  /**
   * When provided, context values will be validated when provide() is called.
   */
  configSchema?: ValidationSchemaInput<T>;
  /**
   * Optional metadata used by docs and tooling.
   */
  meta?: IAsyncContextMeta;
}

/**
 * Runtime async-context accessor returned by `defineAsyncContext(...)`.
 *
 * Async contexts carry per-execution values across async boundaries and can be
 * required by middleware when a task must run inside an active context.
 */
export interface IAsyncContext<T> {
  /** Stable public context id. */
  readonly id: string;
  /** Brand marker used by Runner for registration and runtime checks. */
  [symbolAsyncContext]: true;
  /** Returns the current value or throws when no active value exists. */
  use(): T;
  /** Returns the current value when available, otherwise `undefined`. */
  tryUse(): T | undefined;
  /** Reports whether a value is currently active for this context. */
  has(): boolean;
  /**
   * Runs `fn` with a value bound to this context for the duration of the async call chain.
   */
  provide<R>(value: T, fn: () => Promise<R> | R): Promise<R> | R;
  /**
   * Creates task middleware that fails fast when this context is missing.
   */
  require(): ITaskMiddlewareConfigured<{ context: IAsyncContext<T> }>;

  /** Serializes the current value for transport or persistence scenarios. */
  serialize(data: T): string;
  /** Parses a serialized value back into the context shape. */
  parse(data: string): T;
  /** Optional normalized validation schema associated with the context value. */
  configSchema?: IValidationSchema<T>;
  /** Returns an optional dependency wrapper for this context. */
  optional(): IOptionalDependency<IAsyncContext<T>>;
  /** File path where this async context was defined. */
  [symbolFilePath]: string;
}
