import { defineResource } from "../../define";
import { Queue } from "../../models/Queue";

export const queueResource = defineResource({
  id: "globals.resources.queue",
  context: () => ({
    map: new Map<string, Queue>(),
  }),
  init: async (_, deps, context) => {
    const map = context.map;

    return {
      map,
      run: <T>(
        id: string,
        task: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> => {
        if (!map.has(id)) {
          map.set(id, new Queue());
        }

        return map.get(id)!.run(task);
      },
    };
  },
  dispose: async (value, _, deps, context) => {
    context.map.forEach((queue) => queue.dispose());
  },
  meta: {
    title: "Queue Map",
    description:
      "A global map that can be used to store and retrieve queues. You can run exclusive tasks based on using an id. queue.run(id, task) will run the task in the queue with the given id. If the queue does not exist, it will be created.",
  },
});
