import {
  createDefaultCacheProvider,
  createSharedCacheBudgetState,
  type CacheFactoryOptions,
  type CacheProvider,
  type CacheProviderInput,
  type ICacheProvider,
  type SharedCacheBudgetState,
} from "./cache.shared";
import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import {
  type IResource,
  type IResourceWithConfig,
  type RegisterableItem,
} from "../../defs";
import { extractResourceAndConfig } from "../../tools/extractResourceAndConfig";
import { Match } from "../../tools/check";
import { validationError } from "../../errors";
import { cacheMiddleware } from "./cache.middleware";
import { isResource, isResourceWithConfig } from "../../define";

export type {
  CacheFactoryOptions,
  CacheProvider,
  CacheProviderInput,
  ICacheProvider,
} from "./cache.shared";

type CacheProviderResourceDefinition = IResource<
  any,
  Promise<CacheProvider>,
  any,
  any,
  any,
  any,
  any
>;

export type CacheProviderResource =
  | CacheProviderResourceDefinition
  | IResourceWithConfig<any, Promise<CacheProvider>, any, any, any, any, any>;

export interface CacheResourceConfig {
  defaultOptions?: CacheFactoryOptions;
  provider?: CacheProviderResource;
  totalBudgetBytes?: number;
}

export type CacheResourceValue = {
  map: Map<string, ICacheProvider>;
  pendingCreates: Map<string, Promise<ICacheProvider>>;
  cacheProvider: CacheProvider;
  totalBudgetBytes?: number;
  sharedBudget?: SharedCacheBudgetState;
  defaultOptions: CacheFactoryOptions;
};

const cacheFactoryOptionsPattern = Match.Where(
  (value: unknown): value is CacheFactoryOptions =>
    value !== null && typeof value === "object",
);

const cacheProviderResourcePattern = Match.Where(
  (value: unknown): value is CacheProviderResource =>
    isResource(value) || isResourceWithConfig(value),
);

const totalBudgetBytesPattern = Match.Where(
  (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0,
);

const cacheResourceConfigPattern = Match.ObjectIncluding({
  defaultOptions: Match.Optional(cacheFactoryOptionsPattern),
  provider: Match.Optional(cacheProviderResourcePattern),
  totalBudgetBytes: Match.Optional(totalBudgetBytesPattern),
});

export const cacheProviderResource: CacheProviderResourceDefinition =
  defineResource<void, Promise<CacheProvider>>(
    markFrameworkDefinition({
      id: "runner.cacheProvider",
      init: async () => createDefaultCacheProvider(),
    }),
  );

export const cacheResource = defineResource<
  CacheResourceConfig,
  Promise<CacheResourceValue>,
  { cacheProvider: typeof cacheProviderResource }
>(
  markFrameworkDefinition({
    id: "runner.cache",
    configSchema: cacheResourceConfigPattern,
    // we cast it to :RegisterableItems[] because cacheMiddleware uses cacheResource
    register: (config): RegisterableItem[] => {
      return [config.provider ?? cacheProviderResource, cacheMiddleware];
    },
    dependencies: (config: CacheResourceConfig) => {
      if (config.provider) {
        const { resource } = extractResourceAndConfig(config.provider);
        return { cacheProvider: resource };
      } else {
        return {
          cacheProvider: cacheProviderResource,
        };
      }
    },
    init: async (config: CacheResourceConfig, { cacheProvider }) => {
      if (typeof cacheProvider !== "function") {
        validationError.throw({
          subject: "Cache provider",
          id: "runner.cache",
          originalError:
            "Cache provider resource must initialize to a function: ({ taskId, options }) => provider instance.",
        });
      }

      const sharedBudget = config?.totalBudgetBytes
        ? createSharedCacheBudgetState(config.totalBudgetBytes)
        : undefined;

      return {
        map: new Map<string, ICacheProvider>(),
        pendingCreates: new Map<string, Promise<ICacheProvider>>(),
        cacheProvider,
        totalBudgetBytes: config?.totalBudgetBytes,
        sharedBudget,
        defaultOptions: {
          ttl: 10 * 1000,
          max: 100,
          ttlAutopurge: true,
          ...(config?.defaultOptions ?? {}),
        },
      };
    },
    dispose: async (cache) => {
      cache.pendingCreates?.clear();
      cache.sharedBudget?.entries.clear();
      cache.sharedBudget?.localCaches.clear();
      if (cache.sharedBudget) {
        cache.sharedBudget.totalBytesUsed = 0;
      }
    },
  }),
);

export function createCacheInstance({
  cache,
  cacheOptions,
  taskId,
}: {
  cache: {
    cacheProvider: CacheProvider;
    sharedBudget?: SharedCacheBudgetState;
  };
  cacheOptions: CacheFactoryOptions;
  taskId: string;
}) {
  const input: CacheProviderInput = {
    taskId,
    options: cacheOptions,
    totalBudgetBytes: cache.sharedBudget?.totalBudgetBytes,
    sharedBudget: cache.sharedBudget,
  };

  return cache.cacheProvider(input);
}
