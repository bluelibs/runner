import { defineResource } from "../../definers/defineResource";
import { queueDisposedError } from "../../errors";
import { Queue } from "../../models/Queue";

const IDLE_QUEUE_EVICTION_MS = 60_000;

type CleanupTimer = ReturnType<typeof setTimeout>;

function normalizeQueueDisposalError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function throwQueueDisposalErrors(errors: readonly Error[]): void {
  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  const aggregateError = new Error("One or more queues failed to dispose.");
  aggregateError.name = "AggregateError";

  throw Object.assign(aggregateError, {
    errors,
    cause: errors[0],
  });
}

export const queueResource = defineResource({
  id: "queue",
  context: () => ({
    disposed: false,
    map: new Map<string, Queue>(),
    cleanupTimers: new Map<string, CleanupTimer>(),
  }),
  init: async (_, _deps, context) => {
    const map = context.map;
    const cleanupTimers = context.cleanupTimers;

    const clearCleanupTimer = (id: string): void => {
      const timer = cleanupTimers.get(id);
      if (!timer) return;
      clearTimeout(timer);
      cleanupTimers.delete(id);
    };

    const disposeQueue = (id: string, queue: Queue): void => {
      clearCleanupTimer(id);
      map.delete(id);
      void queue.dispose().catch(() => undefined);
    };

    const scheduleIdleCleanup = (id: string): void => {
      const queue = map.get(id);
      if (!queue || !queue.isIdle()) return;

      clearCleanupTimer(id);
      const timer = setTimeout(() => {
        const current = map.get(id);
        if (!current || !current.isIdle()) {
          cleanupTimers.delete(id);
          return;
        }
        disposeQueue(id, current);
      }, IDLE_QUEUE_EVICTION_MS);
      timer.unref?.();
      cleanupTimers.set(id, timer);
    };

    const getOrCreateQueue = (id: string): Queue => {
      const existing = map.get(id);
      if (existing) return existing;

      const queue = new Queue();
      queue.on("finish", () => {
        scheduleIdleCleanup(id);
      });
      queue.on("error", () => {
        scheduleIdleCleanup(id);
      });
      queue.on("disposed", () => {
        clearCleanupTimer(id);
        map.delete(id);
      });

      map.set(id, queue);
      return queue;
    };

    return {
      map,
      run: <T>(
        id: string,
        task: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> => {
        if (context.disposed) {
          return Promise.reject(queueDisposedError.new());
        }

        clearCleanupTimer(id);
        const queue = getOrCreateQueue(id);

        return queue.run(task);
      },
    };
  },
  dispose: async (_value, _, _deps, context) => {
    context.disposed = true;
    context.cleanupTimers.forEach((timer: CleanupTimer) => {
      clearTimeout(timer);
    });
    context.cleanupTimers.clear();
    const queues = Array.from(context.map.values());
    context.map.clear();

    const results = await Promise.allSettled(
      queues.map((queue) => queue.dispose({ cancel: true })),
    );
    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => normalizeQueueDisposalError(result.reason));

    throwQueueDisposalErrors(errors);
  },
  meta: {
    title: "Queue Map",
    description:
      "A global map that can be used to store and retrieve queues. You can run exclusive tasks based on using an id. queue.run(id, task) will run the task in the queue with the given id. If the queue does not exist, it will be created.",
  },
});
