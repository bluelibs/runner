import { validationError } from "../../../errors";
import type { LiveDataProviderEvent } from "../../live-data/types";
import {
  deferred,
  flush,
  setupRedisProvider,
} from "./redisProvider.test.utils";

describe("RedisLiveDataProvider recovery", () => {
  it("resubscribes before resync and marks disconnect only once", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const events: LiveDataProviderEvent[] = [];
    const close = await provider.subscribe(["topic"], (event) =>
      events.push(event),
    );
    subscriber.emit("close");
    subscriber.emit("end");
    expect(provider.connected).toBe(false);
    expect(events).toEqual([{ type: "disconnect" }]);

    const ack = deferred();
    subscriber.subscribeResults.push(ack.promise);
    subscriber.emit("ready");
    await flush();
    expect(events).toEqual([{ type: "disconnect" }]);
    ack.resolve();
    await flush();
    expect(provider.connected).toBe(true);
    expect(events).toEqual([{ type: "disconnect" }, { type: "resync" }]);
    await close();
    await provider.dispose();
  });

  it("restarts resubscription for a ready event from a newer generation", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const events: LiveDataProviderEvent[] = [];
    const close = await provider.subscribe(["topic"], (event) =>
      events.push(event),
    );
    const firstAck = deferred();
    subscriber.subscribeResults.push(firstAck.promise);
    subscriber.emit("close");
    subscriber.emit("ready");
    await flush();
    expect(subscriber.subscribed).toHaveLength(2);

    const secondAck = deferred();
    subscriber.subscribeResults.push(secondAck.promise);
    subscriber.emit("close");
    subscriber.emit("ready");
    firstAck.resolve();
    await flush();
    expect(subscriber.subscribed).toHaveLength(3);
    expect(provider.connected).toBe(false);

    secondAck.resolve();
    await flush();
    expect(provider.connected).toBe(true);
    expect(events).toEqual([{ type: "disconnect" }, { type: "resync" }]);
    await close();
    await provider.dispose();
  });

  it("continues a queued newer generation after a stale subscribe rejects", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const events: LiveDataProviderEvent[] = [];
    const close = await provider.subscribe(["topic"], (event) =>
      events.push(event),
    );
    const staleAck = deferred();
    subscriber.subscribeResults.push(staleAck.promise);
    subscriber.emit("close");
    subscriber.emit("ready");
    await flush();

    subscriber.emit("close");
    subscriber.emit("ready");
    staleAck.reject(new Error("stale connection failed"));
    await flush();

    expect(subscriber.subscribed).toHaveLength(3);
    expect(provider.connected).toBe(true);
    expect(events).toEqual([{ type: "disconnect" }, { type: "resync" }]);
    await close();
    await provider.dispose();
  });

  it("coalesces duplicate ready events in one generation", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const listener = jest.fn();
    const close = await provider.subscribe(["topic"], listener);
    const ack = deferred();
    subscriber.subscribeResults.push(ack.promise);
    subscriber.emit("close");
    subscriber.emit("ready");
    subscriber.emit("ready");
    ack.resolve();
    await flush();

    expect(subscriber.subscribed).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ type: "resync" });
    await close();
    await provider.dispose();
  });

  it("recovers after a resubscribe failure without an unhandled rejection", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const events: LiveDataProviderEvent[] = [];
    const close = await provider.subscribe(["topic"], (event) =>
      events.push(event),
    );
    subscriber.emit("close");
    subscriber.subscribeResults.push(Promise.reject(new Error("redis down")));
    subscriber.emit("ready");
    subscriber.emit("ready");
    await flush();
    expect(provider.connected).toBe(false);
    expect(subscriber.subscribed).toHaveLength(2);
    expect(events).toEqual([{ type: "disconnect" }]);

    subscriber.emit("ready");
    await flush();
    expect(provider.connected).toBe(true);
    expect(events).toEqual([{ type: "disconnect" }, { type: "resync" }]);
    await close();
    await provider.dispose();
  });

  it("does not resync or retain a subscription disposed during its ACK", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const listener = jest.fn();
    const close = await provider.subscribe(["topic"], listener);
    const ack = deferred();
    subscriber.subscribeResults.push(ack.promise);
    subscriber.emit("close");
    subscriber.emit("ready");
    await flush();
    const disposal = provider.dispose();
    ack.reject(new Error("subscription closed"));
    await disposal;
    await flush();

    expect(provider.connected).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    await close();
  });

  it("rejects a subscribe that completes after disposal", async () => {
    const { provider, subscriber } = setupRedisProvider();
    const ack = deferred();
    subscriber.subscribeResults.push(ack.promise);
    const subscribing = provider.subscribe(["topic"], jest.fn());
    await flush();
    const disposal = provider.dispose();
    ack.resolve();

    await disposal;
    await expect(subscribing).rejects.toHaveProperty("id", validationError.id);
  });
});
