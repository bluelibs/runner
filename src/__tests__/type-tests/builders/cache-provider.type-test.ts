import { r, resources } from "../../../";
import type {
  CacheProvider,
  ICacheProvider,
} from "../../../globals/middleware/cache.middleware";

// Type-only tests for cache provider wiring through resources.cache.with(...)
{
  const validProvider = r
    .resource("types-cache-provider-valid")
    .init(async (): Promise<CacheProvider> => {
      return async (_input): Promise<ICacheProvider> => ({
        get: async (_key: string) => undefined,
        set: async (_key: string, _value: unknown) => undefined,
        clear: async () => undefined,
        has: async (_key: string) => true,
      });
    })
    .build();

  resources.cache.with({ provider: validProvider });
  resources.cache.with({ totalBudgetBytes: 1024 });

  r.override(resources.cacheProvider, async () => {
    return async ({ options }) => {
      options.ttl?.toFixed();

      return {
        get: async (_key: string) => undefined,
        set: async (_key: string, _value: unknown) => undefined,
        clear: async () => undefined,
        has: async (_key: string) => true,
      };
    };
  });

  const invalidProviderResource = r
    .resource("types-cache-provider-invalid-resource")
    .init(async () => 123)
    .build();

  resources.cache.with({
    // @ts-expect-error provider must return cache provider function
    provider: invalidProviderResource,
  });

  const invalidFactoryProvider = r
    .resource("types-cache-provider-invalid-factory")
    .init(async () => async (_input: Record<string, unknown>) => ({
      get: async (_key: string) => undefined,
      set: async (_key: string, _value: unknown) => undefined,
      // Missing clear()
    }))
    .build();

  resources.cache.with({
    // @ts-expect-error provider-produced cache object must implement clear()
    provider: invalidFactoryProvider,
  });

  const invalidHasProvider = r
    .resource("types-cache-provider-invalid-has")
    .init(async () => async (_input: Record<string, unknown>) => ({
      get: async (_key: string) => undefined,
      set: async (_key: string, _value: unknown) => undefined,
      clear: async () => undefined,
      has: async (_key: string) => "yes",
    }))
    .build();

  resources.cache.with({
    // @ts-expect-error has() must return boolean | Promise<boolean>
    provider: invalidHasProvider,
  });

  const invalidLegacyProvider = r
    .resource("types-cache-provider-invalid-legacy")
    .init(async () => async (options: Record<string, unknown>) => ({
      get: async (_key: string) => options,
      set: async (_key: string, _value: unknown) => undefined,
      clear: async () => undefined,
    }))
    .build();

  resources.cache.with({
    // @ts-expect-error provider input must be the task-scoped cache provider shape
    provider: invalidLegacyProvider,
  });

  resources.cache.with({
    // @ts-expect-error totalBudgetBytes must be a number
    totalBudgetBytes: "1024",
  });
}
