import { defineResource } from "../../define";
import { Queue } from "../../models/Queue";

const IDLE_QUEUE_EVICTION_MS = 60_000;

type CleanupTimer = ReturnType<typeof setTimeout>;

export const queueResource = defineResource({
  id: "globals.resources.queue",
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
      void queue.dispose();
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
          return Promise.reject(new Error("Queue resource has been disposed"));
        }

        clearCleanupTimer(id);
        const queue = getOrCreateQueue(id);

        return queue.run(task);
      },
    };
  },
  dispose: async (_value, _, _deps, context) => {
    context.disposed = true;
    context.cleanupTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    context.cleanupTimers.clear();
    context.map.forEach((queue) => {
      void queue.dispose();
    });
    context.map.clear();
  },
  meta: {
    title: "Queue Map",
    description:
      "A global map that can be used to store and retrieve queues. You can run exclusive tasks based on using an id. queue.run(id, task) will run the task in the queue with the given id. If the queue does not exist, it will be created.",
  },
});
