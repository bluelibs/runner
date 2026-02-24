import {
  EventEmissionFailureMode,
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventEmission,
  IEventEmitOptions,
  IEventEmitReport,
} from "../defs";
import { lockedError, shutdownLockdownError, validationError } from "../errors";
import { IHook } from "../types/hook";
import {
  EventEmissionInterceptor,
  HandlerOptionsDefaults,
  HookExecutionInterceptor,
  IEventHandlerOptions,
} from "./event/types";
import { ListenerRegistry, createListener } from "./event/ListenerRegistry";
import { composeInterceptors } from "./event/InterceptorPipeline";
import { CycleContext } from "./event/CycleContext";
import { EmissionContext, EventEmissionImpl } from "./event/EmissionContext";
import { getPlatform } from "../platform";
import { InFlightTracker } from "./utils/inFlightTracker";

/**
 * EventManager handles event emission, listener registration, and event processing.
 * It supports both specific event listeners and global listeners that handle all events.
 * Listeners are processed in order based on their priority.
 */
export class EventManager {
  private static readonly shutdownLockdownAllowedEventIds = new Set<string>([
    "globals.events.drained",
  ]);

  // Interceptors storage (tests access these directly)
  private emissionInterceptors: EventEmissionInterceptor[] = [];
  private hookInterceptors: HookExecutionInterceptor[] = [];

  private readonly registry: ListenerRegistry;
  private readonly cycleContext: CycleContext;
  private shutdownLockdown = false;
  private readonly emissionExecutionContext =
    getPlatform().hasAsyncLocalStorage()
      ? getPlatform().createAsyncLocalStorage<boolean>()
      : null;
  private readonly inFlightTracker = new InFlightTracker(() =>
    Boolean(this.emissionExecutionContext?.getStore()),
  );

  // Locking mechanism to prevent modifications after initialization
  #isLocked = false;

  // Feature flags
  private readonly runtimeEventCycleDetection: boolean;

  constructor(options?: { runtimeEventCycleDetection?: boolean }) {
    this.runtimeEventCycleDetection =
      options?.runtimeEventCycleDetection ?? true;
    this.registry = new ListenerRegistry();
    this.cycleContext = new CycleContext(this.runtimeEventCycleDetection);
  }

  // ==================== PUBLIC API ====================

  /**
   * Gets the current lock status of the EventManager
   */
  get isLocked() {
    return this.#isLocked;
  }

  get inFlightEmissions() {
    return this.inFlightTracker.getCount();
  }

  public enterShutdownLockdown() {
    this.shutdownLockdown = true;
  }

  public waitForIdle(options?: {
    allowCurrentContext?: boolean;
  }): Promise<void> {
    return this.inFlightTracker.waitForIdle(options);
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
    if (
      this.shutdownLockdown &&
      !this.canEmitDuringShutdownLockdown(
        params.eventDefinition as IEvent<unknown>,
        params.source,
      )
    ) {
      shutdownLockdownError.throw();
    }

    this.inFlightTracker.start();
    try {
      const emitWork = async () => {
        const { eventDefinition, source } = params;
        let { data } = params;
        // Snapshot interceptors so in-flight emissions stay deterministic even if
        // dispose() clears interceptor registries after grace timeout.
        const emissionInterceptorsSnapshot = this.emissionInterceptors.slice();
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
          const allListeners =
            this.registry.getListenersForEmit(eventDefinition);

          const event = new EventEmissionImpl<TInput>(
            eventDefinition.id,
            data,
            new Date(),
            source,
            { ...(eventDefinition.meta || {}) },
            [...eventDefinition.tags],
          );

          const context = new EmissionContext<TInput>(
            eventDefinition,
            allListeners,
            failureMode,
            emissionInterceptorsSnapshot,
            event,
          );

          await context.runInterceptor(0, event);

          const executionReport = context.executionReport;
          const deepestEvent = context.deepestEvent;

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
                cause: executionReport.errors[0],
              },
            );
          }
          return {
            emission: deepestEvent as IEventEmission<TInput>,
            report: executionReport,
          };
        };

        return this.cycleContext.runEmission(frame, source, processEmission);
      };

      return this.emissionExecutionContext
        ? await this.emissionExecutionContext.run(true, emitWork)
        : await emitWork();
    } finally {
      this.inFlightTracker.end();
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
   * Removes listeners registered with the provided listener id.
   */
  removeListenerById(id: string): void {
    this.checkLock();
    this.registry.removeListenerById(id);
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

  private canEmitDuringShutdownLockdown(
    eventDefinition: IEvent<unknown>,
    source: string,
  ): boolean {
    return (
      source === "run" &&
      EventManager.shutdownLockdownAllowedEventIds.has(eventDefinition.id)
    );
  }

  /**
   * Disposes the EventManager, releasing all listeners and interceptors.
   */
  dispose(): void {
    this.shutdownLockdown = false;
    this.inFlightTracker.reset();
    this.registry.clear();
    this.emissionInterceptors.length = 0;
    this.hookInterceptors.length = 0;
  }
}

// Re-export public types for compatibility
export type { IEventHandlerOptions };
export type { EventEmissionInterceptor, HookExecutionInterceptor };
