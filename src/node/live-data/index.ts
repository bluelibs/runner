import { mongo } from "./mongo";
import { query } from "./query";
import { topic } from "./topic";

/** Node-only helpers for exact-topic live queries and MongoDB read bindings. */
export const live = Object.freeze({ topic, query, mongo });

export { RedisLiveDataProvider } from "./redisProvider";
export {
  liveDataProviderResource,
  liveDataResource,
  redisLiveDataProviderResource,
} from "./resources";
export type { RedisLiveDataProviderConfig } from "./resources";
export type {
  RedisLiveDataClient,
  RedisLiveDataProviderOptions,
} from "./redisProvider";
export type { MongoLiveSourceOptions } from "./mongo";
export type {
  LiveData,
  LiveDataConfig,
  LiveDataProvider,
  LiveDataProviderEvent,
  LiveDataProviderResource,
  LiveQuery,
  LiveQueryOptions,
  LiveSnapshot,
  LiveSubscribeOptions,
  LiveStale,
  LiveSubscription,
  LiveSubscriptionEvent,
  LiveTopic,
} from "./types";
