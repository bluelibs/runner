import {
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventEmission,
} from "../../defs";
import { IHook } from "../../types/hook";

/**
 * Default options for event handlers.
 */
export const HandlerOptionsDefaults = { order: 0 };

/**
 * Internal storage structure for event listeners.
 */
export interface IListenerStorage {
  order: number;
  filter?: (event: IEventEmission<any>) => boolean;
  handler: EventHandlerType;
  /** Optional listener id (from IEventHandlerOptions.id) */
  id?: string;
  /** True when this listener originates from addGlobalListener(). */
  isGlobal: boolean;
}

/**
 * Options for configuring event listeners.
 */
export interface IEventHandlerOptions<T = any> {
  order?: number;
  filter?: (event: IEventEmission<T>) => boolean;
  /**
   * Represents the listener ID. Use this to avoid a listener calling itself.
   */
  id?: string;
}

/**
 * Interceptor for event emissions.
 */
export type EventEmissionInterceptor = (
  next: (event: IEventEmission<any>) => Promise<void>,
  event: IEventEmission<any>,
) => Promise<void>;

/**
 * Interceptor for hook execution.
 */
export type HookExecutionInterceptor = (
  next: (hook: IHook<any, any>, event: IEventEmission<any>) => Promise<any>,
  hook: IHook<any, any>,
  event: IEventEmission<any>,
) => Promise<any>;

/**
 * Shared contract for cycle-aware hook execution.
 */
export type HookExecutor = (
  hook: IHook<any, any>,
  event: IEventEmission<any>,
  computedDependencies: DependencyValuesType<any>,
) => Promise<any>;

/**
 * Utility shape representing an emission frame used for cycle detection.
 */
export interface IEmissionFrame {
  id: string;
  source: string;
}
