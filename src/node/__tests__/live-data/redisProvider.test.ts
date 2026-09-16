import { validationError } from "../../../errors";
import * as ioredis from "../../durable/optionalDeps/ioredis";
import {
  RedisLiveDataProvider,
  type RedisLiveDataClient,
} from "../../live-data/redisProvider";
import type { LiveDataProviderEvent } from "../../live-data/types";
import {
  deferred,
  flush,
  RedisMock,
  setupRedisProvider,
} from "./redisProvider.test.utils";

describe("RedisLiveDataProvider", () => {
  it("awaits one shared subscribe acknowledgement", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const ack = deferred();
    subscriber.subscribeResults.push(ack.promise);
    const first = provider.subscribe(["topic"], jest.fn());
    const second = provider.subscribe(["topic"], jest.fn());
    await flush();
    expect(subscriber.subscribed).toHaveLength(1);

    ack.resolve();
    const [closeFirst, closeSecond] = await Promise.all([first, second]);
    await closeFirst();
    expect(subscriber.unsubscribed).toHaveLength(0);
    await closeSecond();
    expect(subscriber.unsubscribed).toHaveLength(1);
    await closeSecond();
    await provider.dispose();
  });

  it("does not unsubscribe a channel acquired during pending release", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const closeFirst = await provider.subscribe(["topic"], jest.fn());
    const unsubscribeAck = deferred();
    subscriber.unsubscribeResults.push(unsubscribeAck.promise);
    const closing = closeFirst();
    await flush();
    const opening = provider.subscribe(["topic"], jest.fn());
    await flush();
    expect(subscriber.subscribed).toHaveLength(1);

    unsubscribeAck.resolve();
    await closing;
    const closeSecond = await opening;
    expect(subscriber.subscribed).toHaveLength(2);
    await closeSecond();
    await provider.dispose();
  });

  it("resubscribes a channel reacquired during a failed unsubscribe", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const closeFirst = await provider.subscribe(["topic"], jest.fn());
    const unsubscribeAck = deferred();
    const failure = new Error("unsubscribe failed");
    subscriber.unsubscribeResults.push(unsubscribeAck.promise);
    const closing = closeFirst();
    void closing.catch(() => undefined);
    await flush();
    const opening = provider.subscribe(["topic"], jest.fn());
    unsubscribeAck.reject(failure);

    await expect(closing).rejects.toBe(failure);
    const closeSecond = await opening;
    expect(subscriber.subscribed).toHaveLength(2);
    await closeSecond();
    await provider.dispose();
  });

  it("cleans channel state after a failed subscribe", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const failure = new Error("subscribe failed");
    subscriber.subscribeResults.push(Promise.reject(failure));
    await expect(provider.subscribe(["topic"], jest.fn())).rejects.toBe(
      failure,
    );

    const close = await provider.subscribe(["topic"], jest.fn());
    expect(subscriber.subscribed).toHaveLength(2);
    await close();
    expect(subscriber.unsubscribed).toHaveLength(1);
    await provider.dispose();
  });

  it("routes an envelope once and only to intersecting registrations", async () => {
    const { provider, publisher, subscriber } = setupRedisProvider();
    const events: LiveDataProviderEvent[] = [];
    const sameListener = (event: LiveDataProviderEvent) => events.push(event);
    const closeOne = await provider.subscribe(["one", "two"], sameListener);
    const closeTwo = await provider.subscribe(["two"], sameListener);
    const unrelated = jest.fn();
    const closeOther = await provider.subscribe(["other"], unrelated);

    await provider.publish(["one", "two", "one"]);
    expect(publisher.published).toHaveLength(2);
    for (const { channel, payload } of publisher.published) {
      subscriber.emit("message", channel, payload);
    }
    expect(events).toEqual([
      { type: "invalidate", topics: ["one", "two"] },
      { type: "invalidate", topics: ["one", "two"] },
    ]);
    expect(unrelated).not.toHaveBeenCalled();
    subscriber.emit("close");
    expect(events.filter((event) => event.type === "disconnect")).toHaveLength(
      1,
    );

    await Promise.all([closeOne(), closeTwo(), closeOther()]);
    await provider.dispose();
  });

  it("bounds inbound envelopes and the deduplication window", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const listener = jest.fn();
    const close = await provider.subscribe(["topic"], listener);
    const channel = subscriber.subscribed[0]!;
    const invalid = [
      "not-json",
      JSON.stringify({}),
      JSON.stringify({ v: 2, id: "id", topics: ["topic"] }),
      JSON.stringify({ v: 1, id: "", topics: ["topic"] }),
      JSON.stringify({ v: 1, id: "id", topics: [] }),
      JSON.stringify({ v: 1, id: "id", topics: "topic" }),
      JSON.stringify({
        v: 1,
        id: "id",
        topics: Array.from({ length: 129 }, (_, index) => `t${index}`),
      }),
      "x".repeat(70_000),
    ];
    for (const payload of invalid) subscriber.emit("message", channel, payload);
    subscriber.emit(
      "message",
      "unknown-channel",
      JSON.stringify({ v: 1, id: "unknown", topics: ["topic"] }),
    );
    expect(listener).not.toHaveBeenCalled();

    for (let index = 0; index <= 1024; index++) {
      subscriber.emit(
        "message",
        channel,
        JSON.stringify({ v: 1, id: `id-${index}`, topics: ["topic"] }),
      );
    }
    subscriber.emit(
      "message",
      channel,
      JSON.stringify({ v: 1, id: "id-0", topics: ["topic"] }),
    );
    expect(listener).toHaveBeenCalledTimes(1026);
    await close();
    await provider.dispose();
  });

  it("rejects invalid topics, oversized publishes, and transport failures", async () => {
    const { provider, publisher } = setupRedisProvider();
    const tooMany = Array.from({ length: 129 }, (_, index) => `t${index}`);
    await expect(provider.publish([])).rejects.toHaveProperty(
      "id",
      validationError.id,
    );
    await expect(provider.publish([""])).rejects.toHaveProperty(
      "id",
      validationError.id,
    );
    await expect(provider.publish(tooMany)).rejects.toHaveProperty(
      "id",
      validationError.id,
    );
    await expect(provider.publish(["x".repeat(70_000)])).rejects.toHaveProperty(
      "id",
      validationError.id,
    );

    const failure = new Error("publish failed");
    publisher.publishFailure = failure;
    await expect(provider.publish(["topic"])).rejects.toBe(failure);
    await provider.dispose();
  });

  it.each([undefined, "redis://example.test"])(
    "owns clients created for %p",
    async (redis) => {
      const publisher = new RedisMock();
      const subscriber = new RedisMock();
      publisher.duplicateResult = subscriber;
      const create = jest
        .spyOn(ioredis, "createIORedisClient")
        .mockReturnValueOnce(publisher);
      const provider = new RedisLiveDataProvider({ redis });

      await provider.dispose();
      expect(create).toHaveBeenCalledWith(redis);
      expect(subscriber.quitCalls).toBe(1);
      expect(publisher.quitCalls).toBe(1);
      create.mockRestore();
    },
  );

  it("attempts every owned close and keeps disposal idempotent", async () => {
    const publisher = new RedisMock();
    const subscriber = new RedisMock();
    const failure = new Error("subscriber quit failed");
    subscriber.quitFailure = failure;
    publisher.duplicateResult = subscriber;
    const create = jest
      .spyOn(ioredis, "createIORedisClient")
      .mockReturnValueOnce(publisher);
    const provider = new RedisLiveDataProvider();

    const disposal = provider.dispose();
    expect(provider.dispose()).toBe(disposal);
    await expect(disposal).rejects.toBe(failure);
    expect(subscriber.quitCalls).toBe(1);
    expect(publisher.quitCalls).toBe(1);
    create.mockRestore();
  });

  it("preserves borrowed ownership and rejects work after disposal", async () => {
    const { provider, publisher, subscriber } = setupRedisProvider("end");
    expect(provider.connected).toBe(false);
    await provider.dispose();
    expect(publisher.quitCalls).toBe(0);
    expect(subscriber.quitCalls).toBe(1);
    await expect(provider.publish(["topic"])).rejects.toHaveProperty(
      "id",
      validationError.id,
    );
    await expect(
      provider.subscribe(["topic"], jest.fn()),
    ).rejects.toHaveProperty("id", validationError.id);
    subscriber.emit("close");
    subscriber.emit("ready");
  });

  it("rejects incompatible publisher and duplicate clients", () => {
    expect(
      () => new RedisLiveDataProvider({ redis: {} as RedisLiveDataClient }),
    ).toThrow(validationError.id);
    const publisher = new RedisMock();
    publisher.duplicateResult = {} as RedisLiveDataClient;
    expect(() => new RedisLiveDataProvider({ redis: publisher })).toThrow(
      validationError.id,
    );
  });
});
