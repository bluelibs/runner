import { IOptionalDependency, IValidationSchema } from "../defs";
import { TagType } from "./tag";
import { IEventMeta } from "./meta";
import { symbolEvent, symbolFilePath } from "./utilities";

export type EventHandlerType<T = any> = (
  event: IEventEmission<T>,
) => any | Promise<any>;

export interface IEventDefinition<TPayload = void> {
  id: string;
  meta?: IEventMeta;
  /**
   * Optional validation schema for runtime payload validation.
   * When provided, event payload will be validated when emitted.
   */
  payloadSchema?: IValidationSchema<TPayload>;
  tags?: TagType[];
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
