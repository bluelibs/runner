import { middleware } from "../../../";

{
  middleware.task.rateLimit.with({
    windowMs: 1_000,
    max: 1,
    keyBuilder: (taskId, input, helpers) => {
      taskId.toUpperCase();
      void input;
      helpers?.storageTaskId.toUpperCase();
      return helpers?.storageTaskId ?? taskId;
    },
  });

  middleware.task.cache.with({
    ttl: 1_000,
    keyBuilder: (_taskId, input: { id: string }, helpers) => ({
      cacheKey: `${helpers?.storageTaskId}:user:${input.id}`,
      refs: [`user:${input.id}`],
    }),
  });
}
