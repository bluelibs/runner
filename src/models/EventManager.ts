import {
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventDefinition,
  IEventEmission,
} from "../defs";
import { lockedError, eventCycleError, validationError } from "../errors";
import { globalTags } from "../globals/globalTags";
import { IHook } from "../types/hook";
import { getPlatform, IAsyncLocalStorage } from "../platform";

/**
 * Default options for event handlers
 */
const HandlerOptionsDefaults = { order: 0 };

/**
 * Internal storage structure for event listeners
 */
interface IListenerStorage {
  order: number;
  filter?: (event: IEventEmission<any>) => boolean;
  handler: EventHandlerType;
  /** Optional listener id (from IEventHandlerOptions.id) */
  id?: string;
  /** True when this listener originates from addGlobalListener(). */
  isGlobal: boolean;
}

/**
 * Options for configuring event listeners
 */
export interface IEventHandlerOptions<T = any> {
  order?: number;
  filter?: (event: IEventEmission<T>) => boolean;
  /**
   * Represents the listener ID. Use this to avoid a listener calling himself.
   */
  id?: string;
}

/**
 * Interceptor for event emissions
 */
export type EventEmissionInterceptor = (
  next: (event: IEventEmission<any>) => Promise<void>,
  event: IEventEmission<any>,
) => Promise<void>;

/**
 * Interceptor for hook execution
 */
export type HookExecutionInterceptor = (
  next: (hook: IHook<any, any>, event: IEventEmission<any>) => Promise<any>,
  hook: IHook<any, any>,
  event: IEventEmission<any>,
) => Promise<any>;

/**
 * EventManager handles event emission, listener registration, and event processing.
 * It supports both specific event listeners and global listeners that handle all events.
 * Listeners are processed in order based on their priority.
 */
export class EventManager {
  // Core storage for event listeners
  private listeners: Map<string, IListenerStorage[]> = new Map();
  private globalListeners: IListenerStorage[] = [];

  // Caching system for merged listeners to improve performance
  private cachedMergedListeners: Map<string, IListenerStorage[]> = new Map();
  private globalListenersCacheValid = true;

  // Interceptors storage
  private emissionInterceptors: EventEmissionInterceptor[] = [];
  private hookInterceptors: HookExecutionInterceptor[] = [];

  // Tracks the current emission chain to detect cycles
  private readonly emissionStack!: IAsyncLocalStorage<any> | null;
  // Tracks currently executing hook id (if any)
  private readonly currentHookIdContext!: IAsyncLocalStorage<string> | null;

  // Locking mechanism to prevent modifications after initialization
  #isLocked = false;

  // Feature flags
  private readonly runtimeCycleDetection: boolean;

  constructor(options?: { runtimeCycleDetection?: boolean }) {
    this.runtimeCycleDetection = options?.runtimeCycleDetection ?? true;

    // Store based on the platform.
    if (getPlatform().hasAsyncLocalStorage() && this.runtimeCycleDetection) {
      this.emissionStack =
        getPlatform().createAsyncLocalStorage<
          { id: string; source: string }[]
        >();
      this.currentHookIdContext =
        getPlatform().createAsyncLocalStorage<string>();
    } else {
      this.runtimeCycleDetection = false;
      this.emissionStack = null;
      this.currentHookIdContext = null;
    }
  }

  // ==================== PUBLIC API ====================

  /**
   * Gets the current lock status of the EventManager
   */
  get isLocked() {
    return this.#isLocked;
  }

  /**
   * Locks the EventManager, preventing any further modifications to listeners
   */
  lock() {
    this.#isLocked = true;
  }

  /**
   * Emits an event to all registered listeners for that event type.
   * Listeners are processed in order of priority and can stop event propagation.
   *
   * @param eventDefinition - The event definition to emit
   * @param data - The event payload data
   * @param source - The source identifier of the event emitter
   */
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
  ): Promise<void> {
    // Validate payload with schema if provided
    if (eventDefinition.payloadSchema) {
      try {
        data = eventDefinition.payloadSchema.parse(data);
      } catch (error) {
        validationError.throw({
          subject: "Event payload",
          id: eventDefinition.id,
          originalError:
            error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    const frame = { id: eventDefinition.id, source };
    const processEmission = async () => {
      const excludeFromGlobal =
        globalTags.excludeFromGlobalHooks.exists(eventDefinition);

      // Choose listeners: if globals are excluded, only use event-specific listeners
      const allListeners = excludeFromGlobal
        ? this.listeners.get(eventDefinition.id) || []
        : this.getCachedMergedListeners(eventDefinition.id);

      let propagationStopped = false;

      const event: IEventEmission = {
        id: eventDefinition.id,
        data,
        timestamp: new Date(),
        source,
        meta: eventDefinition.meta || {},
        stopPropagation: () => {
          propagationStopped = true;
        },
        isPropagationStopped: () => propagationStopped,
        tags: eventDefinition.tags,
      };

      // Create the base emission function
      const baseEmit = async (
        eventToEmit: IEventEmission<any>,
      ): Promise<void> => {
        if (allListeners.length === 0) {
          return;
        }

        if (eventDefinition.parallel) {
          await this.executeInParallel(allListeners, eventToEmit);
        } else {
          await this.executeSequentially(
            allListeners,
            eventToEmit,
            () => propagationStopped,
          );
        }
      };

      // Apply emission interceptors (last added runs first)
      let emitWithInterceptors: (event: IEventEmission<any>) => Promise<void> =
        baseEmit;

      // Reverse the interceptors so the last added runs first
      const reversedInterceptors = [...this.emissionInterceptors].reverse();

      for (const interceptor of reversedInterceptors) {
        const nextFunction = emitWithInterceptors;
        emitWithInterceptors = async (eventToEmit: IEventEmission<any>) =>
          interceptor(nextFunction, eventToEmit);
      }

      // Execute the emission with interceptors
      await emitWithInterceptors(event);
    };

    if (
      this.runtimeCycleDetection &&
      this.emissionStack &&
      this.currentHookIdContext
    ) {
      // Detect re-entrant event cycles: same event id appearing in the current chain
      const currentStack = this.emissionStack.getStore();
      if (currentStack) {
        const cycleStart = currentStack.findIndex(
          (f: { id: string; source: string }) => f.id === frame.id,
        );
        if (cycleStart !== -1) {
          const top = currentStack[currentStack.length - 1];
          const currentHookId = this.currentHookIdContext.getStore();
          const safeReEmitBySameHook =
            top.id === frame.id && currentHookId && currentHookId === source;

          if (!safeReEmitBySameHook) {
            eventCycleError.throw({
              path: [...currentStack.slice(cycleStart), frame],
            });
          }
        }
      }

      const nextStack = currentStack ? [...currentStack, frame] : [frame];
      await this.emissionStack.run(nextStack, processEmission);
    } else {
      // Fast path without AsyncLocalStorage context tracking
      await processEmission();
    }
  }

  /**
   * Registers an event listener for specific event(s).
   * Listeners are ordered by priority and executed in ascending order.
   *
   * @param event - The event definition(s) to listen for
   * @param handler - The callback function to handle the event
   * @param options - Configuration options for the listener
   */
  addListener<T>(
    event: IEvent<T> | Array<IEvent<T>>,
    handler: EventHandlerType<T>,
    options: IEventHandlerOptions<T> = HandlerOptionsDefaults,
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
      id: options.id,
      isGlobal: false,
    };

    if (Array.isArray(event)) {
      event.forEach((id) => this.addListener(id, handler, options));
    } else {
      const eventId = event.id;
      const listeners = this.listeners.get(eventId);
      if (listeners) {
        this.insertListener(listeners, newListener);
      } else {
        this.listeners.set(eventId, [newListener]);
      }
      this.invalidateCache(eventId);
    }
  }

  /**
   * Registers a global event listener that handles all events.
   * Global listeners are mixed with specific listeners and ordered by priority.
   *
   * @param handler - The callback function to handle events
   * @param options - Configuration options for the listener
   */
  addGlobalListener(
    handler: EventHandlerType,
    options: IEventHandlerOptions = HandlerOptionsDefaults,
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
      id: options.id,
      isGlobal: true,
    };
    this.insertListener(this.globalListeners, newListener);
    this.invalidateCache();
  }

  /**
   * Checks if there are any listeners registered for the given event
   *
   * @param eventDefinition - The event definition to check
   * @returns true if listeners exist, false otherwise
   */
  hasListeners<T>(eventDefinition: IEvent<T>): boolean {
    const eventListeners = this.listeners.get(eventDefinition.id) || [];

    if (eventListeners.length > 0) {
      return true;
    }

    if (this.globalListeners.length === 0) {
      return false;
    }

    const isExcludedFromGlobal =
      globalTags.excludeFromGlobalHooks.exists(eventDefinition);

    return !isExcludedFromGlobal;
  }

  /**
   * Adds an interceptor for all event emissions
   * Interceptors are executed in the order they are added, with the ability to
   * modify, log, or prevent event emissions
   *
   * @param interceptor - The interceptor function to add
   */
  intercept(interceptor: EventEmissionInterceptor): void {
    this.checkLock();
    this.emissionInterceptors.push(interceptor);
  }

  /**
   * Adds an interceptor for hook execution
   * Interceptors are executed in the order they are added, with the ability to
   * modify, log, or prevent hook execution
   *
   * @param interceptor - The interceptor function to add
   */
  interceptHook(interceptor: HookExecutionInterceptor): void {
    this.checkLock();
    this.hookInterceptors.push(interceptor);
  }

  /**
   * Executes a hook with all registered hook interceptors applied
   * This method should be used by TaskRunner when executing hooks
   *
   * @param hook - The hook to execute
   * @param event - The event that triggered the hook
   * @param computedDependencies - The computed dependencies for the hook
   * @returns Promise resolving to the hook execution result
   */
  async executeHookWithInterceptors(
    hook: IHook<any, any>,
    event: IEventEmission<any>,
    computedDependencies: DependencyValuesType<any>,
  ): Promise<any> {
    // Base hook execution function
    const baseExecute = async (
      hookToExecute: IHook<any, any>,
      eventForHook: IEventEmission<any>,
    ): Promise<any> => {
      try {
        const result = await hookToExecute.run(
          eventForHook,
          computedDependencies,
        );

        return result;
      } catch (err: unknown) {
        throw err;
      }
    };

    // Apply hook interceptors (last added runs first)
    let executeWithInterceptors: (
      hook: IHook<any, any>,
      event: IEventEmission<any>,
    ) => Promise<any> = baseExecute;

    // Reverse the interceptors so the last added runs first
    const reversedInterceptors = [...this.hookInterceptors].reverse();

    for (const interceptor of reversedInterceptors) {
      const nextFunction = executeWithInterceptors;
      executeWithInterceptors = async (
        hookToExecute: IHook<any, any>,
        eventForHook: IEventEmission<any>,
      ) => interceptor(nextFunction, hookToExecute, eventForHook);
    }

    // Execute the hook with interceptors within current hook context
    if (this.runtimeCycleDetection) {
      return await this.currentHookIdContext?.run(
        hook.id,
        async () => await executeWithInterceptors(hook, event),
      );
    } else {
      return await executeWithInterceptors(hook, event);
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Throws an error if the EventManager is locked
   */
  private checkLock() {
    if (this.#isLocked) {
      lockedError.throw({ what: "EventManager" });
    }
  }

  /**
   * Merges two sorted arrays of listeners while maintaining order.
   * Used to combine event-specific listeners with global listeners.
   *
   * @param a - First array of listeners
   * @param b - Second array of listeners
   * @returns Merged and sorted array of listeners
   */
  private mergeSortedListeners(
    a: IListenerStorage[],
    b: IListenerStorage[],
  ): IListenerStorage[] {
    const result: IListenerStorage[] = [];
    let i = 0,
      j = 0;
    while (i < a.length && j < b.length) {
      if (a[i].order <= b[j].order) {
        result.push(a[i++]);
      } else {
        result.push(b[j++]);
      }
    }
    while (i < a.length) result.push(a[i++]);
    while (j < b.length) result.push(b[j++]);
    return result;
  }

  /**
   * Inserts a new listener into a sorted array using binary search.
   * Maintains order based on listener priority.
   *
   * @param listeners - Array to insert into
   * @param newListener - Listener to insert
   */
  private insertListener(
    listeners: IListenerStorage[],
    newListener: IListenerStorage,
  ): void {
    let low = 0;
    let high = listeners.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (listeners[mid].order < newListener.order) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    listeners.splice(low, 0, newListener);
  }



  /**
   * Retrieves cached merged listeners for an event, or creates them if not cached.
   * Combines event-specific listeners with global listeners and sorts them by priority.
   *
   * @param eventId - The event ID to get listeners for
   * @returns Array of merged listeners sorted by priority
   */
  private getCachedMergedListeners(eventId: string): IListenerStorage[] {
    if (!this.globalListenersCacheValid) {
      this.cachedMergedListeners.clear();
      this.globalListenersCacheValid = true;
    }

    let cached = this.cachedMergedListeners.get(eventId);
    if (!cached) {
      const eventListeners = this.listeners.get(eventId) || [];
      if (eventListeners.length === 0 && this.globalListeners.length === 0) {
        cached = [];
      } else if (eventListeners.length === 0) {
        cached = this.globalListeners;
      } else if (this.globalListeners.length === 0) {
        cached = eventListeners;
      } else {
        cached = this.mergeSortedListeners(
          eventListeners,
          this.globalListeners,
        );
      }
      this.cachedMergedListeners.set(eventId, cached);
    }
    return cached;
  }

  /**
   * Invalidates the cached merged listeners.
   * If eventId is provided, only invalidates cache for that specific event.
   * Otherwise, invalidates the global cache.
   *
   * @param eventId - Optional specific event ID to invalidate
   */
  private invalidateCache(eventId?: string): void {
    if (eventId) {
      this.cachedMergedListeners.delete(eventId);
    } else {
      this.globalListenersCacheValid = false;
    }
  }

  /**
   * Executes listeners sequentially.
   *
   * @param listeners - Sorted array of listeners
   * @param event - The event emission object
   * @param isPropagationStopped - Function to check if propagation has been stopped
   */
  private async executeSequentially(
    listeners: IListenerStorage[],
    event: IEventEmission<any>,
    isPropagationStopped: () => boolean,
  ): Promise<void> {
    for (const listener of listeners) {
      if (isPropagationStopped()) {
        break;
      }

      // Skip handlers that identify themselves as the source of this event
      if (listener.id && listener.id === event.source) {
        continue;
      }

      if (!listener.filter || listener.filter(event)) {
        await listener.handler(event);
      }
    }
  }

  /**
   * Executes listeners in parallel batches based on order.
   *
   * @param listeners - Sorted array of listeners
   * @param event - The event emission object
   */
  private async executeInParallel(
    listeners: IListenerStorage[],
    event: IEventEmission<any>,
  ): Promise<void> {
    let currentOrder = listeners[0].order;
    let currentBatch: typeof listeners = [];

    const executeBatch = async (batch: typeof listeners) => {
      const promises = batch.map(async (listener) => {
        // Skip handlers that identify themselves as the source of this event
        if (listener.id && listener.id === event.source) {
          return;
        }

        if (!listener.filter || listener.filter(event)) {
          await listener.handler(event);
        }
      });
      await Promise.all(promises);
    };

    for (const listener of listeners) {


      if (listener.order !== currentOrder) {
        // Execute previous batch
        await executeBatch(currentBatch);
        // Start new batch
        currentBatch = [];
        currentOrder = listener.order;

        // Check propagation again after batch execution
        if (event.isPropagationStopped()) {
          break;
        }
      }
      currentBatch.push(listener);
    }

    // Execute remaining batch
    if (currentBatch.length > 0 && !event.isPropagationStopped()) {
      await executeBatch(currentBatch);
    }
  }
}
