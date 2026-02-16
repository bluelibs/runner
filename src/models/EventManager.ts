import {
  EventEmissionFailureMode,
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventEmission,
  IEventEmitOptions,
  IEventEmitReport,
} from "../defs";
import { lockedError, validationError } from "../errors";
import { IHook } from "../types/hook";
import {
  EventEmissionInterceptor,
  HandlerOptionsDefaults,
  HookExecutionInterceptor,
  IEventHandlerOptions,
  IListenerStorage,
} from "./event/types";
import { ListenerRegistry, createListener } from "./event/ListenerRegistry";
import { composeInterceptors } from "./event/InterceptorPipeline";
import {
  executeInParallel,
  executeSequentially,
} from "./event/EmissionExecutor";
import { CycleContext } from "./event/CycleContext";

/**
 * EventManager handles event emission, listener registration, and event processing.
 * It supports both specific event listeners and global listeners that handle all events.
 * Listeners are processed in order based on their priority.
 */
export class EventManager {
  // Core storage for event listeners (kept for backward-compatibility with tests)
  private listeners: Map<string, IListenerStorage[]>;
  private globalListeners: IListenerStorage[];
  private cachedMergedListeners: Map<string, IListenerStorage[]>;

  // Interceptors storage (tests access these directly)
  private emissionInterceptors: EventEmissionInterceptor[] = [];
  private hookInterceptors: HookExecutionInterceptor[] = [];

  private readonly registry: ListenerRegistry;
  private readonly cycleContext: CycleContext;

  // Locking mechanism to prevent modifications after initialization
  #isLocked = false;

  // Feature flags
  private readonly runtimeEventCycleDetection: boolean;

  constructor(options?: { runtimeEventCycleDetection?: boolean }) {
    this.runtimeEventCycleDetection =
      options?.runtimeEventCycleDetection ?? true;
    this.registry = new ListenerRegistry();
    this.cycleContext = new CycleContext(this.runtimeEventCycleDetection);

    // expose registry collections for backward-compatibility (tests reach into these)
    this.listeners = this.registry.listeners;
    this.globalListeners = this.registry.globalListeners;
    this.cachedMergedListeners = this.registry.cachedMergedListeners;
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
  ): Promise<void>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
    options: IEventEmitOptions & { report: true },
  ): Promise<IEventEmitReport>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport> {
    const result = await this.emitAndReturnEmission({
      eventDefinition,
      data,
      source,
      options,
    });
    if (options?.report) {
      return result.report;
    }
  }

  /**
   * Emits an event and returns the final payload.
   * The payload is taken from the deepest emission object that reached either:
   * - the base listener executor, or
   * - an interceptor that short-circuited the emission.
   *
   * This enables tunnel transports to return the final payload after local and/or remote delivery.
   */
  async emitWithResult<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
  ): Promise<TInput> {
    const result = await this.emitAndReturnEmission({
      eventDefinition,
      data,
      source,
    });
    return result.emission.data as TInput;
  }

  private async emitAndReturnEmission<TInput>(params: {
    eventDefinition: IEvent<TInput>;
    data: TInput;
    source: string;
    options?: IEventEmitOptions;
  }): Promise<{ emission: IEventEmission<TInput>; report: IEventEmitReport }> {
    const { eventDefinition, source } = params;
    let { data } = params;
    const configuredFailureMode =
      params.options?.failureMode ?? EventEmissionFailureMode.FailFast;
    const shouldThrow = params.options?.throwOnError ?? true;
    const failureMode =
      !shouldThrow &&
      configuredFailureMode === EventEmissionFailureMode.FailFast
        ? EventEmissionFailureMode.Aggregate
        : configuredFailureMode;

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
    const processEmission = async (): Promise<{
      emission: IEventEmission<TInput>;
      report: IEventEmitReport;
    }> => {
      const allListeners = this.registry.getListenersForEmit(eventDefinition);

      let propagationStopped = false;

      const event: IEventEmission<TInput> = {
        id: eventDefinition.id,
        data,
        timestamp: new Date(),
        source,
        meta: { ...(eventDefinition.meta || {}) },
        stopPropagation: () => {
          propagationStopped = true;
        },
        isPropagationStopped: () => propagationStopped,
        tags: [...eventDefinition.tags],
      };

      // Create the base emission function
      const baseEmit = async (
        eventToEmit: IEventEmission<any>,
      ): Promise<IEventEmitReport> => {
        if (allListeners.length === 0) {
          return {
            totalListeners: 0,
            attemptedListeners: 0,
            skippedListeners: 0,
            succeededListeners: 0,
            failedListeners: 0,
            propagationStopped: eventToEmit.isPropagationStopped(),
            errors: [],
          };
        }

        if (eventDefinition.parallel) {
          return executeInParallel({
            listeners: allListeners,
            event: eventToEmit,
            failureMode,
          });
        } else {
          return executeSequentially({
            listeners: allListeners,
            event: eventToEmit,
            isPropagationStopped: () => propagationStopped,
            failureMode,
          });
        }
      };

      // Interceptors can replace the event object and/or short-circuit emission.
      // Track the deepest event object that was reached to extract the final payload.
      let deepestEvent: IEventEmission<any> = event as IEventEmission<any>;

      let executionReport: IEventEmitReport = {
        totalListeners: allListeners.length,
        attemptedListeners: 0,
        skippedListeners: 0,
        succeededListeners: 0,
        failedListeners: 0,
        propagationStopped: false,
        errors: [],
      };

      const runInterceptor = async (
        index: number,
        eventToEmit: IEventEmission<any>,
      ): Promise<void> => {
        deepestEvent = eventToEmit;
        const interceptor = this.emissionInterceptors[index];
        if (!interceptor) {
          executionReport = await baseEmit(eventToEmit);
          return;
        }
        return interceptor((nextEvent) => {
          this.assertPropagationMethodsUnchanged(
            eventDefinition.id,
            eventToEmit,
            nextEvent,
          );
          return runInterceptor(index + 1, nextEvent);
        }, eventToEmit);
      };

      await runInterceptor(0, event as IEventEmission<any>);
      if (
        shouldThrow &&
        failureMode === EventEmissionFailureMode.Aggregate &&
        executionReport.errors.length > 0
      ) {
        if (executionReport.errors.length === 1) {
          throw executionReport.errors[0];
        }
        throw Object.assign(
          new Error(`${executionReport.errors.length} listeners failed`),
          {
            name: "AggregateError",
            errors: executionReport.errors,
          },
        );
      }
      return {
        emission: deepestEvent as IEventEmission<TInput>,
        report: executionReport,
      };
    };

    return await this.cycleContext.runEmission(frame, source, processEmission);
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
    const newListener = createListener({
      handler,
      order: options.order,
      filter: options.filter,
      id: options.id,
      isGlobal: false,
    });

    if (Array.isArray(event)) {
      event.forEach((id) => this.addListener(id, handler, options));
    } else {
      const eventId = event.id;
      this.registry.addListener(eventId, newListener);
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
    const newListener = createListener({
      handler,
      order: options.order,
      filter: options.filter,
      id: options.id,
      isGlobal: true,
    });
    this.registry.addGlobalListener(newListener);
  }

  /**
   * Checks if there are any listeners registered for the given event
   *
   * @param eventDefinition - The event definition to check
   * @returns true if listeners exist, false otherwise
   */
  hasListeners<T>(eventDefinition: IEvent<T>): boolean {
    return this.registry.hasListeners(eventDefinition);
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
    const baseExecute = async (
      hookToExecute: IHook<any, any>,
      eventForHook: IEventEmission<any>,
    ): Promise<any> => {
      return hookToExecute.run(eventForHook, computedDependencies);
    };

    const executeWithInterceptors = composeInterceptors(
      this.hookInterceptors,
      baseExecute,
    );

    // Execute the hook with interceptors within current hook context
    return this.cycleContext.isEnabled
      ? await this.cycleContext.runHook(hook.id, () =>
          executeWithInterceptors(hook, event),
        )
      : await executeWithInterceptors(hook, event);
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

  private assertPropagationMethodsUnchanged(
    eventId: string,
    currentEvent: IEventEmission<any>,
    nextEvent: IEventEmission<any>,
  ): void {
    if (
      nextEvent.stopPropagation !== currentEvent.stopPropagation ||
      nextEvent.isPropagationStopped !== currentEvent.isPropagationStopped
    ) {
      validationError.throw({
        subject: "Event interceptor",
        id: eventId,
        originalError: new Error(
          "Interceptors cannot override stopPropagation/isPropagationStopped",
        ),
      });
    }
  }

  /**
   * Disposes the EventManager, releasing all listeners and interceptors.
   */
  dispose(): void {
    this.registry.clear();
    this.emissionInterceptors.length = 0;
    this.hookInterceptors.length = 0;
  }

  /**
   * Retrieves cached merged listeners for an event, or creates them if not cached.
   * Kept for backward compatibility (tests spy on this).
   */
  private getCachedMergedListeners(eventId: string): IListenerStorage[] {
    return this.registry.getCachedMergedListeners(eventId);
  }
}

// Re-export public types for compatibility
export type { IEventHandlerOptions };
export type { EventEmissionInterceptor, HookExecutionInterceptor };
