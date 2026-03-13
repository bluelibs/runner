import {
  EventEmissionFailureMode,
  HookRevertFn,
  IEventEmission,
  IEventEmitReport,
  IEventListenerError,
} from "../../defs";
import {
  transactionalMissingUndoClosureError,
  transactionalRollbackFailureError,
} from "../../errors";
import { normalizeError } from "../../tools/normalizeError";
import { IListenerStorage } from "./types";

interface ExecuteOptions {
  listeners: IListenerStorage[];
  event: IEventEmission<any>;
  isPropagationStopped?: () => boolean;
  failureMode: EventEmissionFailureMode;
}

/**
 * Enriches an error with listener metadata so callers can trace
 * which listener failed and at what priority.
 */
function toListenerError(
  error: unknown,
  listener: IListenerStorage,
): IEventListenerError {
  const normalized = normalizeError(error);
  const errObj = normalized as IEventListenerError;

  if (errObj.listenerId === undefined) {
    errObj.listenerId = listener.id;
  }
  if (errObj.listenerOrder === undefined) {
    errObj.listenerOrder = listener.order;
  }
  return errObj;
}

function recordListenerFailure(
  report: IEventEmitReport,
  error: unknown,
  listener: IListenerStorage,
): IEventListenerError {
  const listenerError = toListenerError(error, listener);
  report.failedListeners += 1;
  report.errors.push(listenerError);
  return listenerError;
}

export function createEmptyReport(totalListeners: number): IEventEmitReport {
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

export function createAggregateError(
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
  const report = createEmptyReport(listeners.length);

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
        const errObj = recordListenerFailure(report, error, listener);
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

async function rollbackTransactionalListeners(
  listenersToRollback: Array<{
    listener: IListenerStorage;
    revert: HookRevertFn;
  }>,
): Promise<IEventListenerError[]> {
  const rollbackErrors: IEventListenerError[] = [];
  for (let index = listenersToRollback.length - 1; index >= 0; index--) {
    const rollbackTarget = listenersToRollback[index];
    try {
      await rollbackTarget.revert();
    } catch (error) {
      rollbackErrors.push(toListenerError(error, rollbackTarget.listener));
    }
  }
  return rollbackErrors;
}

export async function executeTransactionally({
  listeners,
  event,
  isPropagationStopped,
}: Omit<ExecuteOptions, "failureMode">): Promise<IEventEmitReport> {
  const report = createEmptyReport(listeners.length);
  const listenersToRollback: Array<{
    listener: IListenerStorage;
    revert: HookRevertFn;
  }> = [];

  for (const listener of listeners) {
    if (isPropagationStopped?.()) {
      report.propagationStopped = true;
      break;
    }

    if (!shouldExecuteListener(listener, event)) {
      report.skippedListeners += 1;
      continue;
    }

    report.attemptedListeners += 1;
    try {
      const revertFn = await listener.handler(event);
      if (typeof revertFn !== "function") {
        transactionalMissingUndoClosureError.throw({
          eventId: event.id,
          listenerId: listener.id,
          listenerOrder: listener.order,
        });
      }

      listenersToRollback.push({
        listener,
        revert: revertFn as HookRevertFn,
      });
      report.succeededListeners += 1;
    } catch (error) {
      const triggerError = recordListenerFailure(report, error, listener);

      const rollbackErrors =
        await rollbackTransactionalListeners(listenersToRollback);

      if (rollbackErrors.length > 0) {
        const rollbackError = transactionalRollbackFailureError.new({
          eventId: event.id,
          triggerMessage: triggerError.message,
          triggerListenerId: triggerError.listenerId,
          triggerListenerOrder: triggerError.listenerOrder,
          rollbackFailures: rollbackErrors.map((rollbackFailure) => ({
            message: rollbackFailure.message,
            listenerId: rollbackFailure.listenerId,
            listenerOrder: rollbackFailure.listenerOrder,
          })),
        });

        throw Object.assign(rollbackError, {
          cause: triggerError,
          triggerError,
          rollbackErrors,
        });
      }

      throw triggerError;
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
  const report = createEmptyReport(listeners.length);

  if (listeners.length === 0 || event.isPropagationStopped()) {
    report.propagationStopped = event.isPropagationStopped();
    return report;
  }

  let currentOrder = listeners[0].order;
  let currentBatch: typeof listeners = [];

  const executeBatch = async (batch: typeof listeners): Promise<void> => {
    const batchErrors: IEventListenerError[] = [];

    await Promise.all(
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
          const errObj = recordListenerFailure(report, error, listener);
          batchErrors.push(errObj);
        }
      }),
    );

    if (
      batchErrors.length > 0 &&
      failureMode === EventEmissionFailureMode.FailFast
    ) {
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
  if (listener.id && listener.id === event.source.id) {
    return false;
  }
  return !listener.filter || listener.filter(event);
}
