import {
  EventEmissionFailureMode,
  IEvent,
  IEventEmission,
  IEventEmitReport,
  IEventEmitOptions,
  TagType,
} from "../../defs";
import {
  transactionalParallelConflictError,
  validationError,
} from "../../errors";
import {
  EventDispatchAdapter,
  EventEmissionInterceptor,
  IListenerStorage,
} from "./types";
import { symbolDefinitionIdentity } from "../../types/symbols";
import {
  createEmptyReport,
  executeInParallel,
  executeSequentially,
  executeTransactionally,
} from "./EmissionExecutor";
import { RuntimeCallSource } from "../../types/runtimeSource";

export class EventEmissionImpl<TInput> implements IEventEmission<TInput> {
  private propagationStopped = false;
  public readonly [symbolDefinitionIdentity]?: object;

  constructor(
    public readonly id: string,
    public readonly path: string,
    public readonly data: TInput,
    public readonly timestamp: Date,
    public readonly signal: AbortSignal | undefined,
    public readonly source: RuntimeCallSource,
    public readonly meta: Record<string, any>,
    public readonly transactional: boolean,
    public readonly tags: TagType[],
    definitionIdentity?: object,
  ) {
    this[symbolDefinitionIdentity] = definitionIdentity;
  }

  stopPropagation = () => {
    this.propagationStopped = true;
  };

  isPropagationStopped = () => {
    return this.propagationStopped;
  };
}

// Guards the interceptor chain: propagation control lives in a closure on the
// original EventEmissionImpl instance. If an interceptor swaps those methods
// on its nextEvent, stop signals become invisible to executeSequentially.
function assertPropagationMethodsUnchanged(
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
 * Runs the base listener execution strategy for an event. Shared by the
 * interceptor-aware `EmissionContext` and by the interceptor-free fast path.
 */
export function executeEventListeners(
  eventDefinition: IEvent<any>,
  listeners: IListenerStorage[],
  event: IEventEmission<any>,
  failureMode: EventEmissionFailureMode,
): Promise<IEventEmitReport> {
  if (eventDefinition.transactional && eventDefinition.parallel) {
    transactionalParallelConflictError.throw({ eventId: eventDefinition.id });
  }

  if (eventDefinition.transactional) {
    return executeTransactionally({
      listeners,
      event,
      isPropagationStopped: event.isPropagationStopped,
    });
  }

  if (eventDefinition.parallel) {
    return executeInParallel({ listeners, event, failureMode });
  }

  return executeSequentially({
    listeners,
    event,
    isPropagationStopped: event.isPropagationStopped,
    failureMode,
  });
}

export class EmissionContext<TInput> {
  public deepestEvent: IEventEmission<any>;
  // Lazily created: the common path replaces it with the executor's report,
  // so eagerly allocating one here would be wasted work.
  private currentReport: IEventEmitReport | undefined;

  constructor(
    private readonly eventDefinition: IEvent<TInput>,
    private readonly allListeners: IListenerStorage[],
    private readonly failureMode: EventEmissionFailureMode,
    private readonly emissionInterceptors: readonly EventEmissionInterceptor[],
    initialEvent: IEventEmission<TInput>,
    private readonly dispatchAdapter?: EventDispatchAdapter,
    private readonly emitOptions: IEventEmitOptions = {},
  ) {
    this.deepestEvent = initialEvent;
  }

  get executionReport(): IEventEmitReport {
    return (this.currentReport ??= createEmptyReport(this.allListeners.length));
  }

  async baseEmit(eventToEmit: IEventEmission<any>): Promise<IEventEmitReport> {
    const bridged = this.dispatchAdapter?.(
      this.eventDefinition,
      eventToEmit,
      this.allListeners,
      this.emitOptions,
    );
    if (bridged) return await bridged;
    if (this.allListeners.length === 0) {
      this.executionReport.propagationStopped =
        eventToEmit.isPropagationStopped();
      return this.executionReport;
    }

    return executeEventListeners(
      this.eventDefinition,
      this.allListeners,
      eventToEmit,
      this.failureMode,
    );
  }

  async runInterceptor(
    index: number,
    eventToEmit: IEventEmission<any>,
  ): Promise<void> {
    this.deepestEvent = eventToEmit;
    const interceptor = this.emissionInterceptors[index];
    if (!interceptor) {
      this.currentReport = await this.baseEmit(eventToEmit);
      return;
    }
    let didCallNext = false;
    return interceptor((nextEvent) => {
      if (didCallNext) {
        validationError.throw({
          subject: "Event interceptor",
          id: this.eventDefinition.id,
          originalError: "Interceptors can call next() only once per emission.",
        });
      }
      didCallNext = true;
      assertPropagationMethodsUnchanged(
        this.eventDefinition.id,
        eventToEmit,
        nextEvent,
      );
      return this.runInterceptor(index + 1, nextEvent);
    }, eventToEmit);
  }
}
