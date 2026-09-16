import { createHash } from "node:crypto";
import { validationError } from "../../errors";
import { Match } from "../../tools/check";
import type { RedisLiveDataClient } from "./redisProvider.types";

export const MAX_REDIS_MESSAGE_BYTES = 64 * 1024;
export const MAX_REDIS_TOPICS_PER_MESSAGE = 128;

interface RedisLiveDataEnvelope {
  readonly v: 1;
  readonly id: string;
  readonly topics: readonly string[];
}

const topicKeysPattern = Match.ArrayOf(Match.NonEmptyString);
const envelopePattern = Match.compile(
  Match.ObjectStrict({
    v: 1,
    id: Match.NonEmptyString,
    topics: topicKeysPattern,
  }),
);
const clientMethods = [
  "publish",
  "subscribe",
  "unsubscribe",
  "duplicate",
  "quit",
  "on",
] as const;
const clientPattern = Match.compile(
  Match.Where(
    (value: unknown): value is RedisLiveDataClient =>
      value !== null &&
      typeof value === "object" &&
      clientMethods.every(
        (method) => typeof Reflect.get(value, method) === "function",
      ),
  ),
);

export function normalizeRedisTopicKeys(topicKeys: unknown): readonly string[] {
  if (!Match.test(topicKeys, topicKeysPattern)) {
    return invalidRedis("topic keys must be non-empty strings.");
  }
  const topics = [...new Set(topicKeys)];
  if (topics.length === 0 || topics.length > MAX_REDIS_TOPICS_PER_MESSAGE) {
    return invalidRedis(
      `requires between 1 and ${MAX_REDIS_TOPICS_PER_MESSAGE} topics per operation.`,
    );
  }
  return topics;
}

export function parseRedisEnvelope(
  payload: string,
): RedisLiveDataEnvelope | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (!envelopePattern.test(value)) return null;
    const topics = [...new Set(value.topics)];
    if (topics.length === 0 || topics.length > MAX_REDIS_TOPICS_PER_MESSAGE) {
      return null;
    }
    return { ...value, topics };
  } catch {
    return null;
  }
}

export function isRedisLiveDataClient(
  value: unknown,
): value is RedisLiveDataClient {
  return clientPattern.test(value);
}

export function redisLiveDataChannel(prefix: string, topic: string): string {
  const digest = createHash("sha256").update(topic).digest("base64url");
  return `${prefix}:${digest}`;
}

export function redisSetsIntersect(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export function invalidRedis(message: string): never {
  return validationError.throw({
    subject: "Redis live-data provider",
    id: "redisLiveDataProvider",
    originalError: message,
  });
}
