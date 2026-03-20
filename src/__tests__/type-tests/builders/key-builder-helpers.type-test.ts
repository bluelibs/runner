import { middleware } from "../../../";

{
  middleware.task.rateLimit.with({
    windowMs: 1_000,
    max: 1,
    keyBuilder: (canonicalTaskId: string, input: unknown) => {
      canonicalTaskId.toUpperCase();
      void input;
      return canonicalTaskId;
    },
  });

  middleware.task.cache.with({
    ttl: 1_000,
    keyBuilder: (canonicalTaskId, input: { id: string }) => ({
      cacheKey: `${canonicalTaskId}:user:${input.id}`,
      refs: [`user:${input.id}`],
    }),
  });
}
