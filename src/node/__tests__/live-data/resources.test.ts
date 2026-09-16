import { r, run } from "../../../index";
import { createMemoryLiveDataProvider } from "../../live-data/memoryProvider";
import { query } from "../../live-data/query";
import {
  liveDataProviderResource,
  liveDataResource,
  redisLiveDataProviderResource,
} from "../../live-data/resources";
import {
  RedisLiveDataProvider,
  type RedisLiveDataClient,
} from "../../live-data/redisProvider";
import { topic } from "../../live-data/topic";

class RedisClientMock implements RedisLiveDataClient {
  readonly status = "ready";
  readonly subscribed: string[] = [];
  quitCalls = 0;
  duplicateResult: RedisLiveDataClient = this;

  async publish(): Promise<number> {
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    this.subscribed.push(channel);
    return 1;
  }

  async unsubscribe(): Promise<number> {
    return 1;
  }

  duplicate(): RedisLiveDataClient {
    return this.duplicateResult;
  }

  async quit(): Promise<string> {
    this.quitCalls++;
    return "OK";
  }

  on(): this {
    return this;
  }
}

function redisPair() {
  const publisher = new RedisClientMock();
  const subscriber = new RedisClientMock();
  publisher.duplicateResult = subscriber;
  return { publisher, subscriber };
}

describe("live-data resource schemas", () => {
  it("accepts native and configured provider resources", () => {
    const read = r
      .task("resource-schema-read")
      .run(async () => "value")
      .build();
    const liveQuery = query({ task: read, topics: () => topic("records") });
    const pair = redisPair();
    const configuredProvider = redisLiveDataProviderResource.with({
      redis: pair.publisher,
    });
    const schema = liveDataResource.configSchema!;

    expect(
      schema.parse({
        queries: [liveQuery],
        provider: liveDataProviderResource,
      }),
    ).toBeDefined();
    expect(
      schema.parse({ queries: [liveQuery], provider: configuredProvider }),
    ).toBeDefined();
    expect(() =>
      schema.parse({ queries: [liveQuery], provider: "invalid" }),
    ).toThrow();
  });

  it("validates Redis URLs and every required borrowed-client method", () => {
    const schema = redisLiveDataProviderResource.configSchema!;
    expect(
      schema.parse({ redis: "redis://localhost", prefix: "live" }),
    ).toEqual({ redis: "redis://localhost", prefix: "live" });

    expect(() => schema.parse({ redis: null })).toThrow();
    expect(() => schema.parse({ redis: 42 })).toThrow();

    const methodNames = [
      "publish",
      "subscribe",
      "unsubscribe",
      "duplicate",
      "quit",
      "on",
    ] as const;
    const partialClient: Record<string, () => void> = {};
    for (const methodName of methodNames) {
      expect(() => schema.parse({ redis: { ...partialClient } })).toThrow();
      partialClient[methodName] = () => undefined;
    }
    expect(schema.parse({ redis: partialClient })).toEqual({
      redis: partialClient,
    });
  });
});

describe("live-data provider resource lifecycle", () => {
  async function runRedisResource(prefix?: string) {
    const pair = redisPair();
    const configured = redisLiveDataProviderResource.with(
      prefix === undefined
        ? { redis: pair.publisher }
        : { redis: pair.publisher, prefix },
    );
    const app = r
      .resource(`redis-provider-app-${prefix ?? "default"}`)
      .register([configured])
      .build();
    const runtime = await run(app);
    const provider = runtime.getResourceValue(redisLiveDataProviderResource);
    expect(provider).toBeInstanceOf(RedisLiveDataProvider);
    const close = await provider.subscribe(["topic"], jest.fn());
    await close();
    await runtime.dispose();
    expect(pair.publisher.quitCalls).toBe(0);
    expect(pair.subscriber.quitCalls).toBe(1);
    return pair.subscriber.subscribed[0]!;
  }

  it("uses explicit and isolated default Redis prefixes and disposes clients", async () => {
    await expect(runRedisResource("fixed-live-prefix")).resolves.toMatch(
      /^fixed-live-prefix:/,
    );
    await expect(runRedisResource()).resolves.toMatch(/^runner:live-data:/);
  });

  it("fails fast for incompatible providers and missing identity context", async () => {
    const init = liveDataResource.init!;
    type Dependencies = Parameters<typeof init>[1];
    const provider = createMemoryLiveDataProvider();
    const missingIdentityDependencies = {
      provider,
      serializer: {},
      store: {
        findIdByDefinition: () => "missing-identity",
        resources: new Map(),
      },
      taskRunner: {},
      timers: {},
    } as unknown as Dependencies;

    await expect(
      init.call(
        { id: "live-data-without-identity" },
        { queries: [] },
        missingIdentityDependencies,
        undefined as never,
      ),
    ).rejects.toThrow(/configured identity context is unavailable/);

    await expect(
      init.call(
        { id: "live-data-with-invalid-provider" },
        { queries: [] },
        { ...missingIdentityDependencies, provider: {} } as Dependencies,
        undefined as never,
      ),
    ).rejects.toThrow(/compatible LiveDataProvider/);
    await provider.dispose();
  });

  it("tolerates lifecycle hooks receiving no initialized service", async () => {
    await liveDataResource.cooldown!(
      {} as never,
      undefined as never,
      {} as never,
      undefined as never,
    );
    await liveDataResource.dispose!(
      {} as never,
      undefined as never,
      {} as never,
      undefined as never,
    );
  });
});
