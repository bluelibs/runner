import { IOptionalDependency, IValidationSchema } from "./utilities";
import { TagType } from "./tag";
import { IEventMeta } from "./meta";
import { CommonPayload, symbolEvent, symbolFilePath } from "./utilities";

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>,
) => any | Promise<any>;

export const EventEmissionFailureMode = {
  FailFast: "fail-fast",
  Aggregate: "aggregate",
} as const;

export type EventEmissionFailureMode =
  (typeof EventEmissionFailureMode)[keyof typeof EventEmissionFailureMode];

export interface IEventListenerError extends Error {
  listenerId?: string;
  listenerOrder?: number;
}

export interface IEventEmitReport {
  totalListeners: number;
  attemptedListeners: number;
  skippedListeners: number;
  succeededListeners: number;
  failedListeners: number;
  propagationStopped: boolean;
  errors: IEventListenerError[];
}

export interface IEventEmitOptions {
  /**
   * Controls error behavior during listener execution.
   * - fail-fast (default): throw on first failure.
   * - aggregate: continue execution and collect listener errors.
   */
  failureMode?: EventEmissionFailureMode;
  /**
   * When false, suppress throwing even if listener errors occurred.
   * Defaults to true.
   */
  throwOnError?: boolean;
  /**
   * When true, `emit(...)`/dependency event emitter returns `IEventEmitReport`.
   */
  report?: boolean;
}

// Helper to keep tuple inference intact for multi-event hooks
export function onAnyOf<T extends readonly IEventDefinition<any>[]>(
  ...defs: T
): T {
  return defs;
}

/**
 * Runtime guard that checks if an emission belongs to one of the given event defs.
 * Narrows payload type to the intersection of the provided events' payloads.
 */
export function isOneOf<TDefs extends readonly IEventDefinition<any>[]>(
  emission: IEventEmission<any>,
  defs: TDefs,
): emission is IEventEmission<CommonPayload<TDefs>> {
  return defs.some((d) => d.id === emission.id);
}

export interface IEventDefinition<TPayload = void> {
  id: string;
  meta?: IEventMeta;
  /**
   * Optional validation schema for runtime payload validation.
   * When provided, event payload will be validated when emitted.
   */
  payloadSchema?: IValidationSchema<TPayload>;
  tags?: TagType[];
  /**
   * If true, listeners with the same priority run concurrently within a batch.
   * Batches (grouped by order) still execute sequentially in priority order.
   */
  parallel?: boolean;
}

/**
 * The definioten of the event.
 * This is different from the event emission.
 */
export interface IEvent<TPayload = any> extends IEventDefinition<TPayload> {
  id: string;
  /**
   * We use this event to discriminate between resources with just 'id' and 'events' as they collide. This is a workaround, should be redone using classes and instanceof.
   */
  [symbolEvent]: true;
  [symbolFilePath]: string;
  /** Return an optional dependency wrapper for this event. */
  optional: () => IOptionalDependency<IEvent<TPayload>>;
  tags: TagType[];
}

/**
 * This represents the object that is passed to event handlers
 */
export interface IEventEmission<TPayload = any> {
  /**
   * The ID of the event. This is the same as the event's ID.
   * This is useful for global event listeners.
   */
  id: string;
  /**
   * The data that the event carries. It can be anything.
   */
  data: TPayload;
  /**
   * The timestamp when the event was created.
   */
  timestamp: Date;
  /**
   * The source of the event. This can be useful for debugging.
   */
  source: string;
  /**
   * Metadata associated with the event definition.
   */
  meta: IEventMeta;
  /**
   * Stops propagation to remaining event listeners.
   */
  stopPropagation(): void;
  /**
   * Returns true if propagation has been stopped.
   */
  isPropagationStopped(): boolean;
  /**
   * The tags that the event carries.
   */
  tags: TagType[];
}
