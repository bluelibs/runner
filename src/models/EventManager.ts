import {
  EventEmissionFailureMode,
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventEmission,
  IEventEmissionCallOptions,
  IEventEmitReport,
} from "../defs";
import {
  lockedError,
  runtimeAdmissionsPausedError,
  shutdownLockdownError,
  validationError,
} from "../errors";
import { isMatchError } from "../tools/check/errors";
import { EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS } from "../types/executionContext";
import { IHook } from "../types/hook";
import { RuntimeCallSource, runtimeSource } from "../types/runtimeSource";
import {
  IListenerStorage,
  EventDispatchAdapter,
  EventEmissionInterceptor,
  HandlerOptionsDefaults,
  HookExecutionInterceptor,
  HookExecutor,
  IEventHandlerOptions,
} from "./event/types";
import { ListenerRegistry, createListener } from "./event/ListenerRegistry";
import { composeHookInterceptors } from "./event/InterceptorPipeline";
import { ExecutionContextStore } from "./ExecutionContextStore";
import {
  EmissionContext,
  EventEmissionImpl,
  executeEventListeners,
} from "./event/EmissionContext";
import {
  createAggregateError,
  createEmptyReport,
} from "./event/EmissionExecutor";
import { throwCancellationErrorFromSignal } from "../tools/abortSignals";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "./runtime/LifecycleAdmissionController";
import { getDefinitionIdentity } from "../tools/isSameDefinition";

type EventEmissionInternalOptions = IEventEmissionCallOptions & {
  allowLifecycleBypass?: boolean;
};

type EventEmissionRequest = RuntimeCallSource | IEventEmissionCallOptions;
type EventEmissionCallResult<TRequest extends EventEmissionRequest> =
  TRequest extends { report: true } ? IEventEmitReport : void;

function hasEmissionSource(
  value: EventEmissionRequest,
): value is IEventEmissionCallOptions {
  return "source" in value;
}

/**
 * EventManager handles event emission, listener registration, and event processing.
 * It supports both specific event listeners and global listeners that handle all events.
 * Listeners are processed in order based on their priority.
 */
export class EventManager {
  private dispatchAdapter?: EventDispatchAdapter;
  private emissionInterceptors: EventEmissionInterceptor[] = [];
  private hookInterceptors: HookExecutionInterceptor[] = [];
  private hookExecutor: HookExecutor | undefined;
  private readonly hookSources = new WeakMap<
    IHook<any, any>,
    RuntimeCallSource
  >();

  private readonly registry: ListenerRegistry;
  private readonly executionContextStore: ExecutionContextStore;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;

  #isLocked = false;

  constructor(options?: {
    executionContextStore?: ExecutionContextStore;
    lifecycleAdmissionController?: LifecycleAdmissionController;
  }) {
    this.executionContextStore =
      options?.executionContextStore ??
      new ExecutionContextStore(EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS);
    this.registry = new ListenerRegistry();
    this.lifecycleAdmissionController =
      options?.lifecycleAdmissionController ??
      new LifecycleAdmissionController();
  }

  // ==================== PUBLIC API ====================

  get isLocked() {
    return this.#isLocked;
  }

  public enterShutdownLockdown() {
    this.lifecycleAdmissionController.beginDisposing();
  }

  /**
   * Locks the EventManager, preventing further modifications to listeners.
   */
  lock() {
    this.#isLocked = true;
  }

  // ---- Emission API ----

  /**
   * Emits an event through the normal runtime admission path.
   */
  async emit<
    TInput,
    TRequest extends EventEmissionRequest = IEventEmissionCallOptions,
  >(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    request: TRequest,
  ): Promise<EventEmissionCallResult<TRequest>> {
    const options = this.resolveEmissionRequest(request);
    const result = await this.emitCore(eventDefinition, data, options);
    if (options.report) {
      return result.report as EventEmissionCallResult<TRequest>;
    }

    return undefined as EventEmissionCallResult<TRequest>;
  }

  /**
   * Emits a lifecycle event that bypasses shutdown admission checks.
   *
   * This is intentionally narrower than `emit()`: it exists for framework
   * lifecycle events that must still fire while the runtime is already in the
   * disposing phase. Business events should keep using `emit()`.
   */
  async emitLifecycle<
    TInput,
    TRequest extends EventEmissionRequest = IEventEmissionCallOptions,
  >(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    request: TRequest,
  ): Promise<EventEmissionCallResult<TRequest>> {
    const options = this.resolveEmissionRequest(request);
    const result = await this.emitCore(eventDefinition, data, {
      ...options,
      allowLifecycleBypass: true,
    });
    if (options.report) {
      return result.report as EventEmissionCallResult<TRequest>;
    }

    return undefined as EventEmissionCallResult<TRequest>;
  }

  /**
   * Emits an event and returns the final payload from the deepest emission
   * object that reached either the base executor or an interceptor short-circuit.
   */
  async emitWithResult<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    request: EventEmissionRequest,
  ): Promise<TInput> {
    const options = this.resolveEmissionRequest(request);
    const result = await this.emitCore(eventDefinition, data, options);
    return result.emission.data as TInput;
  }

  // ---- Listener API ----

  addListener<T>(
    event: IEvent<T> | Array<IEvent<T>>,
    handler: EventHandlerType<T>,
    options: IEventHandlerOptions<T> = HandlerOptionsDefaults,
  ): void {
    this.checkLock();

    if (Array.isArray(event)) {
      for (const ev of event) this.addListener(ev, handler, options);
      return;
    }

    const newListener = createListener({
      handler,
      order: options.order,
      filter: options.filter,
      id: options.id,
    });
    this.registry.addListener(event.id, newListener);
  }

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
    });
    this.registry.addGlobalListener(newListener);
  }

  removeListenerById(id: string): void {
    this.checkLock();
    this.registry.removeListenerById(id);
  }

  hasListeners<T>(eventDefinition: IEvent<T>): boolean {
    return this.registry.hasListeners(eventDefinition);
  }

  /** Installs one platform-owned dispatch bridge before runtime locking. */
  setDispatchAdapter(adapter: EventDispatchAdapter): void {
    this.checkLock();
    if (this.dispatchAdapter) {
      validationError.throw({
        subject: "Event dispatch bridge",
        id: "eventManager",
        originalError: "Only one event dispatch bridge may be registered.",
      });
    }
    this.dispatchAdapter = adapter;
  }

  /** Snapshots the effective ordered hook registrations for a definition. */
  getDispatchListeners(event: IEvent<any>): readonly IListenerStorage[] {
    return this.registry.getListenersForEmit(event).slice();
  }

  // ---- Interceptor API ----

  intercept(interceptor: EventEmissionInterceptor): void {
    this.checkLock();
    this.emissionInterceptors = [...this.emissionInterceptors, interceptor];
  }

  interceptHook(interceptor: HookExecutionInterceptor): void {
    this.checkLock();
    this.hookInterceptors.push(interceptor);
    this.hookExecutor = undefined;
  }

  /**
   * Executes a hook through the composed interceptor chain.
   */
  async executeHookWithInterceptors(
    hook: IHook<any, any>,
    event: IEventEmission<any>,
    computedDependencies: DependencyValuesType<any>,
  ): Promise<any> {
    const execute = (this.hookExecutor ??= composeHookInterceptors(
      this.hookInterceptors,
    ));
    const hookId = hook.id;
    let hookSource = this.hookSources.get(hook);
    if (!hookSource || hookSource.id !== hookId) {
      hookSource = runtimeSource.hook(hookId);
      this.hookSources.set(hook, hookSource);
    }

    return this.lifecycleAdmissionController.trackHookExecution(
      hookSource,
      () =>
        this.executionContextStore.runInFrame(
          "hook",
          hookSource.id,
          hookSource,
          () => execute(hook, event, computedDependencies),
        ),
    );
  }

  dispose(): void {
    this.dispatchAdapter = undefined;
    this.registry.clear();
    this.emissionInterceptors = [];
    this.hookInterceptors.length = 0;
    this.hookExecutor = undefined;
  }

  // ==================== PRIVATE ====================

  private checkLock() {
    if (this.#isLocked) {
      lockedError.throw({ what: "EventManager" });
    }
  }

  /**
   * Normalizes the 3rd argument into the merged call-options shape used
   * internally. A bare source stays supported as a convenience shorthand.
   */
  private resolveEmissionRequest(
    request: EventEmissionRequest,
  ): IEventEmissionCallOptions {
    if (hasEmissionSource(request)) {
      return request;
    }

    return { source: request };
  }

  /**
   * Core emission pipeline shared by emit(), emitLifecycle(), and emitWithResult().
   */
  private async emitCore<TInput>(
    eventDef: IEvent<TInput>,
    inputData: TInput,
    options: EventEmissionInternalOptions,
  ): Promise<{
    emission: IEventEmission<TInput>;
    report: IEventEmitReport;
  }> {
    if (
      !this.lifecycleAdmissionController.canAdmitEvent(options.source, {
        allowLifecycleBypass: options?.allowLifecycleBypass === true,
      })
    ) {
      if (
        this.lifecycleAdmissionController.getPhase() ===
        RuntimeLifecyclePhase.Paused
      ) {
        runtimeAdmissionsPausedError.throw();
      }
      shutdownLockdownError.throw();
    }

    const eventDefinition = eventDef;
    const metadata = {
      id: eventDefinition.id,
      path: eventDefinition.id,
    };
    const source = options.source;
    const signal = this.executionContextStore.resolveSignal(options.signal);

    if (signal?.aborted) {
      throwCancellationErrorFromSignal(signal);
    }

    let data = inputData;
    if (eventDefinition.payloadSchema) {
      data = this.validatePayload(eventDefinition, metadata.id, data);
    }

    // Interceptor registration and disposal replace this array so an in-flight
    // emission can continue on the original pipeline.
    const interceptors = this.emissionInterceptors;

    const emissionConfig = this.resolveEmissionConfig(eventDefinition, options);

    const identity = getDefinitionIdentity(eventDefinition);

    const processEmission = async (): Promise<{
      emission: IEventEmission<TInput>;
      report: IEventEmitReport;
    }> => {
      const allListeners = this.registry.getListenersForEmit(eventDefinition);
      const event = this.createEmission(
        eventDefinition,
        metadata,
        data,
        signal,
        source,
        identity,
      );

      if (interceptors.length === 0 && !this.dispatchAdapter) {
        const report =
          allListeners.length === 0
            ? createEmptyReport(0)
            : await executeEventListeners(
                eventDefinition,
                allListeners,
                event,
                emissionConfig.failureMode,
              );
        this.throwOnAggregateErrors(
          report,
          emissionConfig.shouldThrow,
          emissionConfig.failureMode,
        );
        return { emission: event, report };
      }

      // The context keeps the deepest event object seen so interceptors can
      // replace the emission wrapper while preserving execution reporting.
      const context = new EmissionContext<TInput>(
        eventDefinition,
        allListeners,
        emissionConfig.failureMode,
        interceptors,
        event,
        this.dispatchAdapter,
        options,
      );

      await context.runInterceptor(0, event);

      this.throwOnAggregateErrors(
        context.executionReport,
        emissionConfig.shouldThrow,
        emissionConfig.failureMode,
      );

      return {
        emission: context.deepestEvent as IEventEmission<TInput>,
        report: context.executionReport,
      };
    };

    return this.lifecycleAdmissionController.trackEventEmission(source, () =>
      this.executionContextStore.runInFrame(
        "event",
        metadata.id,
        source,
        processEmission,
        signal,
      ),
    );
  }

  private createEmission<TInput>(
    eventDefinition: IEvent<TInput>,
    metadata: { id: string; path: string },
    data: TInput,
    signal: AbortSignal | undefined,
    source: RuntimeCallSource,
    identity: object | undefined,
  ): EventEmissionImpl<TInput> {
    return new EventEmissionImpl<TInput>(
      metadata.id,
      metadata.path,
      data,
      new Date(),
      signal,
      source,
      eventDefinition.meta ? { ...eventDefinition.meta } : {},
      Boolean(eventDefinition.transactional),
      eventDefinition.tags.length > 0 ? [...eventDefinition.tags] : [],
      identity,
    );
  }

  /**
   * Resolves the failure-mode and throw behavior for an emission.
   * Transactional events always fail-fast and always throw.
   */
  private resolveEmissionConfig(
    eventDefinition: IEvent<any>,
    options?: EventEmissionInternalOptions,
  ) {
    const isTransactional = Boolean(eventDefinition.transactional);
    const configuredFailureMode = isTransactional
      ? EventEmissionFailureMode.FailFast
      : (options?.failureMode ?? EventEmissionFailureMode.FailFast);
    const shouldThrow = isTransactional
      ? true
      : (options?.throwOnError ?? true);
    const failureMode =
      !shouldThrow &&
      configuredFailureMode === EventEmissionFailureMode.FailFast
        ? EventEmissionFailureMode.Aggregate
        : configuredFailureMode;

    return { failureMode, shouldThrow };
  }

  private validatePayload<TInput>(
    eventDefinition: IEvent<TInput>,
    eventId: string,
    data: TInput,
  ): TInput {
    try {
      return eventDefinition.payloadSchema!.parse(data);
    } catch (error) {
      if (isMatchError(error)) {
        throw error;
      }
      return validationError.throw({
        subject: "Event payload",
        id: eventId,
        originalError:
          error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Throws an aggregate error when the emission collected failures
   * but the caller opted into aggregate mode with throwOnError.
   */
  private throwOnAggregateErrors(
    report: IEventEmitReport,
    shouldThrow: boolean,
    failureMode: EventEmissionFailureMode,
  ): void {
    if (
      !shouldThrow ||
      failureMode !== EventEmissionFailureMode.Aggregate ||
      report.errors.length === 0
    ) {
      return;
    }

    if (report.errors.length === 1) {
      throw report.errors[0];
    }
    throw createAggregateError(
      report.errors,
      `${report.errors.length} listeners failed`,
    );
  }
}

// Re-export public types for compatibility
export type { IEventHandlerOptions };
export type { EventEmissionInterceptor, HookExecutionInterceptor };
