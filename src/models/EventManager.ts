import {
  EventEmissionFailureMode,
  DependencyValuesType,
  EventHandlerType,
  IEvent,
  IEventEmission,
  IEventEmitOptions,
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
  EventEmissionInterceptor,
  HandlerOptionsDefaults,
  HookExecutionInterceptor,
  IEventHandlerOptions,
} from "./event/types";
import { ListenerRegistry, createListener } from "./event/ListenerRegistry";
import { composeInterceptors } from "./event/InterceptorPipeline";
import { ExecutionContextStore } from "./ExecutionContextStore";
import { type ExecutionFrame } from "../types/executionContext";
import { EmissionContext, EventEmissionImpl } from "./event/EmissionContext";
import {
  createAggregateError,
  createEmptyReport,
} from "./event/EmissionExecutor";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "./runtime/LifecycleAdmissionController";
import { getDefinitionIdentity } from "../tools/isSameDefinition";

type EventEmissionInternalOptions = IEventEmitOptions & {
  allowLifecycleBypass?: boolean;
};

/**
 * EventManager handles event emission, listener registration, and event processing.
 * It supports both specific event listeners and global listeners that handle all events.
 * Listeners are processed in order based on their priority.
 */
export class EventManager {
  private emissionInterceptors: EventEmissionInterceptor[] = [];
  private hookInterceptors: HookExecutionInterceptor[] = [];

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

  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
  ): Promise<void>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
    options: IEventEmitOptions & { report: true },
  ): Promise<IEventEmitReport>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport>;
  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport> {
    const result = await this.emitCore(eventDefinition, data, source, options);
    if (options?.report) return result.report;
  }

  /**
   * Emits a lifecycle event that bypasses shutdown admission checks.
   * Used internally during the dispose sequence.
   */
  async emitLifecycle<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport> {
    const result = await this.emitCore(eventDefinition, data, source, {
      ...options,
      allowLifecycleBypass: true,
    });
    if (options?.report) return result.report;
  }

  /**
   * Emits an event and returns the final payload from the deepest emission
   * object that reached either the base executor or an interceptor short-circuit.
   */
  async emitWithResult<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
  ): Promise<TInput> {
    const result = await this.emitCore(eventDefinition, data, source);
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

  // ---- Interceptor API ----

  intercept(interceptor: EventEmissionInterceptor): void {
    this.checkLock();
    this.emissionInterceptors.push(interceptor);
  }

  interceptHook(interceptor: HookExecutionInterceptor): void {
    this.checkLock();
    this.hookInterceptors.push(interceptor);
  }

  /**
   * Executes a hook through the composed interceptor chain.
   */
  async executeHookWithInterceptors(
    hook: IHook<any, any>,
    event: IEventEmission<any>,
    computedDependencies: DependencyValuesType<any>,
  ): Promise<any> {
    const baseExecute = async (
      hookToExecute: IHook<any, any>,
      eventForHook: IEventEmission<any>,
    ): Promise<any> => hookToExecute.run(eventForHook, computedDependencies);

    // Skip composition overhead when no interceptors are registered.
    const execute =
      this.hookInterceptors.length > 0
        ? composeInterceptors(this.hookInterceptors, baseExecute)
        : baseExecute;

    const hookSource: RuntimeCallSource = runtimeSource.hook(hook.id);

    const hookFrame: ExecutionFrame = {
      kind: "hook",
      id: hookSource.id,
      source: hookSource,
      timestamp: Date.now(),
    };

    return this.lifecycleAdmissionController.trackHookExecution(
      hookSource,
      () =>
        this.executionContextStore.runWithFrame(hookFrame, () =>
          execute(hook, event),
        ),
    );
  }

  dispose(): void {
    this.registry.clear();
    this.emissionInterceptors.length = 0;
    this.hookInterceptors.length = 0;
  }

  // ==================== PRIVATE ====================

  private checkLock() {
    if (this.#isLocked) {
      lockedError.throw({ what: "EventManager" });
    }
  }

  /**
   * Core emission pipeline shared by emit(), emitLifecycle(), and emitWithResult().
   */
  private async emitCore<TInput>(
    eventDef: IEvent<TInput>,
    inputData: TInput,
    rawSource: RuntimeCallSource,
    options?: EventEmissionInternalOptions,
  ): Promise<{
    emission: IEventEmission<TInput>;
    report: IEventEmitReport;
    executionContext?: ReturnType<ExecutionContextStore["getSnapshot"]>;
  }> {
    if (
      !this.lifecycleAdmissionController.canAdmitEvent(rawSource, {
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
    const source = rawSource;

    let data = inputData;
    if (eventDefinition.payloadSchema) {
      data = this.validatePayload(eventDefinition, metadata.id, data);
    }

    // Snapshot interceptors so in-flight emissions stay deterministic even if
    // dispose() clears interceptor registries mid-emission.
    const interceptors =
      this.emissionInterceptors.length > 0
        ? this.emissionInterceptors.slice()
        : [];

    const emissionConfig = this.resolveEmissionConfig(eventDefinition, options);

    const identity = getDefinitionIdentity(eventDefinition);

    const processEmission = async (): Promise<{
      emission: IEventEmission<TInput>;
      report: IEventEmitReport;
      executionContext?: ReturnType<ExecutionContextStore["getSnapshot"]>;
    }> => {
      const allListeners = this.registry.getListenersForEmit(eventDefinition);
      const event = this.createEmission(
        eventDefinition,
        metadata,
        data,
        source,
        identity,
      );

      // Fast path: no listeners and no interceptors — no executor needed.
      if (allListeners.length === 0 && interceptors.length === 0) {
        return {
          emission: event as IEventEmission<TInput>,
          report: createEmptyReport(0),
          executionContext: this.executionContextStore.getSnapshot(),
        };
      }

      const context = new EmissionContext<TInput>(
        eventDefinition,
        allListeners,
        emissionConfig.failureMode,
        interceptors,
        event,
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
        executionContext: this.executionContextStore.getSnapshot(),
      };
    };

    const traceFrame: ExecutionFrame = {
      kind: "event",
      id: metadata.id,
      source,
      timestamp: Date.now(),
    };

    return this.lifecycleAdmissionController.trackEventEmission(
      source,
      async () => {
        const result = await this.executionContextStore.runWithFrame(
          traceFrame,
          processEmission,
        );
        return {
          emission: result.emission,
          report: result.report,
          executionContext: result.executionContext,
        };
      },
    );
  }

  private createEmission<TInput>(
    eventDefinition: IEvent<TInput>,
    metadata: { id: string; path: string },
    data: TInput,
    source: RuntimeCallSource,
    identity: object | undefined,
  ): EventEmissionImpl<TInput> {
    return new EventEmissionImpl<TInput>(
      metadata.id,
      metadata.path,
      data,
      new Date(),
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
