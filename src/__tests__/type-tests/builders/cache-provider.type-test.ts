import { r } from "../../../";
import type {
  CacheProvider,
  ICacheProvider,
} from "../../../globals/middleware/cache.middleware";

// Type-only tests for cache provider wiring through r.runner.cache.with(...)
{
  const validProvider = r
    .resource("types.cache.provider.valid")
    .init(async (): Promise<CacheProvider> => {
      return async (_options): Promise<ICacheProvider> => ({
        get: async (_key: string) => undefined,
        set: async (_key: string, _value: unknown) => undefined,
        clear: async () => undefined,
        has: async (_key: string) => true,
      });
    })
    .build();

  r.runner.cache.with({ provider: validProvider });

  const invalidProviderResource = r
    .resource("types.cache.provider.invalid.resource")
    .init(async () => 123)
    .build();

  r.runner.cache.with({
    // @ts-expect-error provider must return cache provider function
    provider: invalidProviderResource,
  });

  const invalidFactoryProvider = r
    .resource("types.cache.provider.invalid.factory")
    .init(async () => async (_options: Record<string, unknown>) => ({
      get: async (_key: string) => undefined,
      set: async (_key: string, _value: unknown) => undefined,
      // Missing clear()
    }))
    .build();

  r.runner.cache.with({
    // @ts-expect-error provider-produced cache object must implement clear()
    provider: invalidFactoryProvider,
  });

  const invalidHasProvider = r
    .resource("types.cache.provider.invalid.has")
    .init(async () => async (_options: Record<string, unknown>) => ({
      get: async (_key: string) => undefined,
      set: async (_key: string, _value: unknown) => undefined,
      clear: async () => undefined,
      has: async (_key: string) => "yes",
    }))
    .build();

  r.runner.cache.with({
    // @ts-expect-error has() must return boolean | Promise<boolean>
    provider: invalidHasProvider,
  });
}
