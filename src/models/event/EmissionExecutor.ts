import {
  EventEmissionFailureMode,
  IEventEmission,
  IEventEmitReport,
  IEventListenerError,
} from "../../defs";
import { IListenerStorage } from "./types";

interface ExecuteOptions {
  listeners: IListenerStorage[];
  event: IEventEmission<any>;
  isPropagationStopped?: () => boolean;
  failureMode: EventEmissionFailureMode;
}

function toListenerError(
  error: unknown,
  listener: IListenerStorage,
): IEventListenerError {
  const errObj: IEventListenerError =
    error && typeof error === "object"
      ? (error as IEventListenerError)
      : new Error(String(error));

  if (errObj.listenerId === undefined) {
    errObj.listenerId = listener.id;
  }
  if (errObj.listenerOrder === undefined) {
    errObj.listenerOrder = listener.order;
  }
  return errObj;
}

function createReport(totalListeners: number): IEventEmitReport {
  return {
    totalListeners,
    attemptedListeners: 0,
    skippedListeners: 0,
    succeededListeners: 0,
    failedListeners: 0,
    propagationStopped: false,
    errors: [],
  };
}

function createAggregateError(
  errors: IEventListenerError[],
  message: string,
): Error {
  return Object.assign(new Error(message), {
    errors,
    name: "AggregateError",
    cause: errors[0],
  });
}

export async function executeSequentially({
  listeners,
  event,
  isPropagationStopped,
  failureMode,
}: ExecuteOptions): Promise<IEventEmitReport> {
  const report = createReport(listeners.length);

  for (const listener of listeners) {
    if (isPropagationStopped?.()) {
      report.propagationStopped = true;
      break;
    }

    if (shouldExecuteListener(listener, event)) {
      report.attemptedListeners += 1;
      try {
        await listener.handler(event);
        report.succeededListeners += 1;
      } catch (error) {
        const errObj = toListenerError(error, listener);
        report.failedListeners += 1;
        report.errors.push(errObj);
        if (failureMode === EventEmissionFailureMode.FailFast) {
          throw errObj;
        }
      }
    } else {
      report.skippedListeners += 1;
    }
  }

  report.propagationStopped =
    report.propagationStopped || event.isPropagationStopped();
  return report;
}

export async function executeInParallel({
  listeners,
  event,
  failureMode,
}: Omit<ExecuteOptions, "isPropagationStopped">): Promise<IEventEmitReport> {
  const report = createReport(listeners.length);

  if (listeners.length === 0 || event.isPropagationStopped()) {
    report.propagationStopped = event.isPropagationStopped();
    return report;
  }

  let currentOrder = listeners[0].order;
  let currentBatch: typeof listeners = [];

  const executeBatch = async (batch: typeof listeners): Promise<void> => {
    const results = await Promise.allSettled(
      batch.map(async (listener) => {
        if (!shouldExecuteListener(listener, event)) {
          report.skippedListeners += 1;
          return;
        }

        report.attemptedListeners += 1;
        try {
          await listener.handler(event);
          report.succeededListeners += 1;
        } catch (error) {
          const errObj = toListenerError(error, listener);
          report.failedListeners += 1;
          report.errors.push(errObj);
          throw errObj;
        }
      }),
    );

    const errorsInBatch = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    ).length;
    if (
      errorsInBatch > 0 &&
      failureMode === EventEmissionFailureMode.FailFast
    ) {
      const batchErrors = report.errors.slice(-errorsInBatch);
      if (batchErrors.length === 1) {
        throw batchErrors[0];
      }
      throw createAggregateError(
        batchErrors,
        `${batchErrors.length} listeners failed in parallel batch`,
      );
    }
  };

  for (const listener of listeners) {
    if (listener.order !== currentOrder) {
      await executeBatch(currentBatch);
      currentBatch = [];
      currentOrder = listener.order;

      if (event.isPropagationStopped()) {
        report.propagationStopped = true;
        break;
      }
    }
    currentBatch.push(listener);
  }

  if (currentBatch.length > 0 && !event.isPropagationStopped()) {
    await executeBatch(currentBatch);
  }

  report.propagationStopped =
    report.propagationStopped || event.isPropagationStopped();
  return report;
}

export function shouldExecuteListener(
  listener: IListenerStorage,
  event: IEventEmission<any>,
): boolean {
  if (listener.id && listener.id === event.source) {
    return false;
  }
  return !listener.filter || listener.filter(event);
}
