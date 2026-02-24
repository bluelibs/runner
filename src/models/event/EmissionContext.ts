import {
  EventEmissionFailureMode,
  IEvent,
  IEventEmission,
  IEventEmitReport,
  TagType,
} from "../../defs";
import { validationError } from "../../errors";
import { EventEmissionInterceptor } from "./types";
import { executeInParallel, executeSequentially } from "./EmissionExecutor";

export class EventEmissionImpl<TInput> implements IEventEmission<TInput> {
  private propagationStopped = false;

  constructor(
    public readonly id: string,
    public readonly data: TInput,
    public readonly timestamp: Date,
    public readonly source: string,
    public readonly meta: Record<string, any>,
    public readonly tags: TagType[],
  ) {}

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

export class EmissionContext<TInput> {
  public deepestEvent: IEventEmission<any>;
  public executionReport: IEventEmitReport;

  constructor(
    private readonly eventDefinition: IEvent<TInput>,
    private readonly allListeners: any[],
    private readonly failureMode: EventEmissionFailureMode,
    private readonly emissionInterceptors: EventEmissionInterceptor[],
    initialEvent: IEventEmission<TInput>,
  ) {
    this.deepestEvent = initialEvent;
    this.executionReport = {
      totalListeners: allListeners.length,
      attemptedListeners: 0,
      skippedListeners: 0,
      succeededListeners: 0,
      failedListeners: 0,
      propagationStopped: false,
      errors: [],
    };
  }

  async baseEmit(eventToEmit: IEventEmission<any>): Promise<IEventEmitReport> {
    if (this.allListeners.length === 0) {
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

    if (this.eventDefinition.parallel) {
      return executeInParallel({
        listeners: this.allListeners,
        event: eventToEmit,
        failureMode: this.failureMode,
      });
    } else {
      return executeSequentially({
        listeners: this.allListeners,
        event: eventToEmit,
        isPropagationStopped: eventToEmit.isPropagationStopped,
        failureMode: this.failureMode,
      });
    }
  }

  async runInterceptor(
    index: number,
    eventToEmit: IEventEmission<any>,
  ): Promise<void> {
    this.deepestEvent = eventToEmit;
    const interceptor = this.emissionInterceptors[index];
    if (!interceptor) {
      this.executionReport = await this.baseEmit(eventToEmit);
      return;
    }
    return interceptor((nextEvent) => {
      assertPropagationMethodsUnchanged(
        this.eventDefinition.id,
        eventToEmit,
        nextEvent,
      );
      return this.runInterceptor(index + 1, nextEvent);
    }, eventToEmit);
  }
}
