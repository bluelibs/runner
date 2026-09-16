import { randomUUID } from "node:crypto";
import { defineResource, isResource, isResourceWithConfig } from "../../define";
import type { IAsyncContext, RegisterableItem } from "../../defs";
import { validationError } from "../../errors";
import { identityContextResource } from "../../globals/resources/identityContext.resource";
import { serializerResource } from "../../globals/resources/serializer.resource";
import { storeResource } from "../../globals/resources/store.resource";
import { taskRunnerResource } from "../../globals/resources/taskRunner.resource";
import { timersResource } from "../../globals/resources/timers.resource";
import { Match } from "../../tools/check";
import { extractResourceAndConfig } from "../../tools/extractResourceAndConfig";
import { createMemoryLiveDataProvider } from "./memoryProvider";
import {
  RedisLiveDataProvider,
  type RedisLiveDataClient,
} from "./redisProvider";
import { LiveDataService } from "./service";
import type {
  LiveData,
  LiveDataConfig,
  LiveDataProvider,
  LiveDataProviderResource,
  LiveQuery,
} from "./types";

export interface RedisLiveDataProviderConfig {
  /** Redis connection string or a compatible borrowed publisher client. */
  redis?: string | RedisLiveDataClient;
  /** Stable prefix shared by every process participating in this live-data bus. */
  prefix?: string;
}

const queryPattern = Match.Where(
  (value: unknown): value is LiveQuery =>
    typeof value === "object" &&
    value !== null &&
    "task" in value &&
    typeof (value as Partial<LiveQuery>).topics === "function",
);

const providerPattern = Match.Where(
  (value: unknown): value is LiveDataProviderResource =>
    isResource(value) || isResourceWithConfig(value),
);

const configPattern = Match.ObjectIncluding({
  queries: Match.ArrayOf(queryPattern),
  provider: Match.Optional(providerPattern),
});

const redisClientPattern = Match.Where(
  (value: unknown): value is RedisLiveDataProviderConfig["redis"] =>
    value === undefined || typeof value === "string" || isRedisClient(value),
);

const redisConfigPattern = Match.ObjectIncluding({
  prefix: Match.Optional(Match.NonEmptyString),
  redis: Match.Optional(redisClientPattern),
});

/** Default runtime-isolated in-memory live-data provider. */
export const liveDataProviderResource = defineResource<
  void,
  Promise<LiveDataProvider>
>({
  id: "liveDataProvider",
  init: async () => createMemoryLiveDataProvider(),
  dispose: async (provider) => provider.dispose(),
  meta: {
    title: "Default Live Data Provider",
    description: "Provides runtime-isolated in-memory live query invalidation.",
  },
});

/** Redis Pub/Sub live-data provider for invalidation across runtime processes. */
export const redisLiveDataProviderResource = defineResource<
  RedisLiveDataProviderConfig,
  Promise<LiveDataProvider>
>({
  id: "redisLiveDataProvider",
  configSchema: redisConfigPattern,
  init: async (config) =>
    new RedisLiveDataProvider({
      redis: config.redis,
      prefix: config.prefix ?? `runner:live-data:${randomUUID()}`,
    }),
  dispose: async (provider) => provider.dispose(),
  meta: {
    title: "Redis Live Data Provider",
    description:
      "Broadcasts exact live query invalidations over per-topic Redis Pub/Sub channels.",
  },
});

/** Runtime owner for registered live queries and subscriptions. */
export const liveDataResource = defineResource<
  LiveDataConfig,
  Promise<LiveData>,
  {
    provider: typeof liveDataProviderResource;
    serializer: typeof serializerResource;
    store: typeof storeResource;
    taskRunner: typeof taskRunnerResource;
    timers: typeof timersResource;
  }
>({
  id: "liveData",
  configSchema: configPattern,
  register: (config): RegisterableItem[] => [
    config.provider ?? liveDataProviderResource,
  ],
  dependencies: (config) => ({
    provider: config.provider
      ? extractResourceAndConfig(config.provider).resource
      : liveDataProviderResource,
    serializer: serializerResource,
    store: storeResource,
    taskRunner: taskRunnerResource,
    timers: timersResource,
  }),
  init: async function (
    this: { id: string },
    config,
    { provider, serializer, store, taskRunner, timers },
  ) {
    assertProvider(provider);
    const identityContextId = store.findIdByDefinition(identityContextResource);
    const identityEntry = store.resources.get(identityContextId);
    const identityContext = (
      identityEntry?.config as { context?: IAsyncContext<any> } | undefined
    )?.context;
    if (!identityContext) {
      return validationError.throw({
        subject: "Live data",
        id: this.id,
        originalError: "Runner's configured identity context is unavailable.",
      });
    }

    return new LiveDataService({
      resourceId: this.id,
      queries: config.queries,
      provider,
      serializer,
      store,
      taskRunner,
      timers,
      identityContext,
    });
  },
  cooldown: async (liveData) => {
    if (liveData instanceof LiveDataService) await liveData.dispose();
  },
  dispose: async (liveData) => {
    if (liveData instanceof LiveDataService) await liveData.dispose();
  },
  meta: {
    title: "Live Data",
    description:
      "Runs registered read tasks and refreshes subscribers after exact topic invalidations.",
  },
});

function assertProvider(provider: LiveDataProvider): void {
  if (
    !provider ||
    typeof provider.publish !== "function" ||
    typeof provider.subscribe !== "function" ||
    typeof provider.dispose !== "function" ||
    typeof provider.connected !== "boolean"
  ) {
    validationError.throw({
      subject: "Live data provider",
      id: "liveData",
      originalError:
        "Provider resources must initialize to a compatible LiveDataProvider.",
    });
  }
}

function isRedisClient(value: unknown): value is RedisLiveDataClient {
  if (!value || typeof value !== "object") return false;
  const client = value as Partial<RedisLiveDataClient>;
  return (
    typeof client.publish === "function" &&
    typeof client.subscribe === "function" &&
    typeof client.unsubscribe === "function" &&
    typeof client.duplicate === "function" &&
    typeof client.quit === "function" &&
    typeof client.on === "function"
  );
}
