import {
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import { EventTagType } from "./tag";
import { IEventMeta } from "./meta";
import {
  CommonPayload,
  symbolDefinitionIdentity,
  symbolEvent,
  symbolFilePath,
} from "./utilities";
import { RuntimeCallSource } from "./runtimeSource";
import {
  hasDefinitionIdentity,
  isSameDefinition,
} from "../tools/isSameDefinition";

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>,
) => any | Promise<any>;

export const EventEmissionFailureMode = {
  FailFast: "fail-fast",
  Aggregate: "aggregate",
} as const;

export type EventEmissionFailureMode =
  (typeof EventEmissionFailureMode)[keyof typeof EventEmissionFailureMode];

/**
 * Listener error enriched with hook metadata when available.
 */
export interface IEventListenerError extends Error {
  listenerId?: string;
  listenerOrder?: number;
}

/**
 * Summary report returned when event emission runs in reporting mode.
 */
export interface IEventEmitReport {
  totalListeners: number;
  attemptedListeners: number;
  skippedListeners: number;
  succeededListeners: number;
  failedListeners: number;
  propagationStopped: boolean;
  errors: IEventListenerError[];
}

/**
 * Runtime options for a single event emission.
 */
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
/**
 * Preserves tuple inference for hook subscriptions spanning multiple events.
 */
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
  if (defs.some((definition) => isSameDefinition(definition, emission))) {
    return true;
  }

  if (hasDefinitionIdentity(emission)) {
    return false;
  }

  return defs.some((definition) => definition.id === emission.id);
}

/**
 * Declarative event definition contract.
 */
export interface IEventDefinition<TPayload = void> {
  /** Stable event identifier within its owner subtree. */
  id: string;
  /** Optional metadata used by docs and tooling. */
  meta?: IEventMeta;
  /**
   * Optional validation schema for runtime payload validation.
   * When provided, event payload will be validated when emitted.
   */
  payloadSchema?: ValidationSchemaInput<TPayload>;
  /** Tags attached to the event for routing or policy decisions. */
  tags?: EventTagType[];
  /**
   * If true, listeners with the same priority run concurrently within a batch.
   * Batches (grouped by order) still execute sequentially in priority order.
   */
  parallel?: boolean;
  /**
   * If true, listeners run in transactional mode and must return an undo closure.
   */
  transactional?: boolean;
}

/**
 * Normalized runtime event definition.
 *
 * This describes the event itself, not a concrete emission instance.
 */
export interface IEvent<TPayload = any> extends IEventDefinition<TPayload> {
  id: string;
  path?: string;
  /**
   * We use this event to discriminate between resources with just 'id' and 'events' as they collide. This is a workaround, should be redone using classes and instanceof.
   */
  [symbolEvent]: true;
  [symbolFilePath]: string;
  /** Normalized payload validation schema. */
  payloadSchema?: IValidationSchema<TPayload>;
  /** Return an optional dependency wrapper for this event. */
  optional: () => IOptionalDependency<IEvent<TPayload>>;
  /** Normalized tags attached to the event. */
  tags: EventTagType[];
}

/**
 * Concrete event emission passed to hooks and wildcard listeners.
 */
export interface IEventEmission<TPayload = any> {
  /**
   * The ID of the event. This is the same as the event's ID.
   * This is useful for global event listeners.
   */
  id: string;
  path?: string;
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
  source: RuntimeCallSource;
  /**
   * Metadata associated with the event definition.
   */
  meta: IEventMeta;
  /**
   * Whether this emission runs in transactional listener mode.
   */
  transactional: boolean;
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
  tags: EventTagType[];
  [symbolDefinitionIdentity]?: object;
}
