import { IEventEmission } from "../../defs";
import { IListenerStorage } from "./types";

/**
 * Error type with optional listener metadata attached.
 */
interface ListenerError extends Error {
  listenerId?: string;
  listenerOrder?: number;
}

/**
 * Aggregate error containing multiple listener errors.
 */
interface ListenerAggregateError extends Error {
  errors: ListenerError[];
}

interface ExecuteOptions {
  listeners: IListenerStorage[];
  event: IEventEmission<any>;
  isPropagationStopped: () => boolean;
}

export async function executeSequentially({
  listeners,
  event,
  isPropagationStopped,
}: ExecuteOptions): Promise<void> {
  for (const listener of listeners) {
    if (isPropagationStopped()) {
      break;
    }

    if (shouldExecuteListener(listener, event)) {
      try {
        await listener.handler(event);
      } catch (error) {
        const errObj: ListenerError =
          error && typeof error === "object"
            ? (error as ListenerError)
            : new Error(String(error));

        if (errObj.listenerId === undefined) {
          errObj.listenerId = listener.id;
        }
        if (errObj.listenerOrder === undefined) {
          errObj.listenerOrder = listener.order;
        }
        throw errObj;
      }
    }
  }
}

export async function executeInParallel({
  listeners,
  event,
}: Omit<ExecuteOptions, "isPropagationStopped">): Promise<void> {
  if (listeners.length === 0 || event.isPropagationStopped()) {
    return;
  }

  let currentOrder = listeners[0].order;
  let currentBatch: typeof listeners = [];

  const executeBatch = async (batch: typeof listeners) => {
    const results = await Promise.allSettled(
      batch.map(async (listener) => {
        if (shouldExecuteListener(listener, event)) {
          await listener.handler(event);
        }
      }),
    );

    const errors = results
      .map((result, index) => ({ result, listener: batch[index] }))
      .filter(
        (
          r,
        ): r is { result: PromiseRejectedResult; listener: IListenerStorage } =>
          r.result.status === "rejected",
      )
      .map(({ result, listener }) => {
        const reason = result.reason;
        const errObj: ListenerError =
          reason && typeof reason === "object"
            ? (reason as ListenerError)
            : new Error(String(reason));

        if (errObj.listenerId === undefined) {
          errObj.listenerId = listener.id;
        }
        if (errObj.listenerOrder === undefined) {
          errObj.listenerOrder = listener.order;
        }

        return errObj;
      });

    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      }
      const aggregateError: ListenerAggregateError = Object.assign(
        new Error(`${errors.length} listeners failed in parallel batch`),
        { errors, name: "AggregateError" },
      );
      throw aggregateError;
    }
  };

  for (const listener of listeners) {
    if (listener.order !== currentOrder) {
      await executeBatch(currentBatch);
      currentBatch = [];
      currentOrder = listener.order;

      if (event.isPropagationStopped()) {
        break;
      }
    }
    currentBatch.push(listener);
  }

  if (currentBatch.length > 0 && !event.isPropagationStopped()) {
    await executeBatch(currentBatch);
  }
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
