import { Serializer } from "../../../serializer";
import { LiveSubscriptionQueue } from "../../live-data/subscription";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("LiveSubscriptionQueue", () => {
  const serializer = new Serializer();

  it("is its own iterator and delivers pending snapshots immediately", async () => {
    const queue = new LiveSubscriptionQueue<{ id: string }>(
      serializer,
      async () => undefined,
    );
    expect(queue[Symbol.asyncIterator]()).toBe(queue);

    const pending = queue.next();
    queue.pushSnapshot(1, serializer.stringify({ id: "one" }));
    await expect(pending).resolves.toEqual({
      done: false,
      value: { type: "snapshot", revision: 1, data: { id: "one" } },
    });
  });

  it("coalesces buffered snapshots and keeps one stale marker", async () => {
    const queue = new LiveSubscriptionQueue<{ id: string }>(
      serializer,
      async () => undefined,
    );
    queue.pushSnapshot(1, serializer.stringify({ id: "old" }));
    queue.pushSnapshot(2, serializer.stringify({ id: "latest" }));
    queue.pushStale();
    queue.pushStale();
    queue.pushSnapshot(3, serializer.stringify({ id: "fresh" }));

    await expect(queue.next()).resolves.toEqual({
      done: false,
      value: { type: "stale", reason: "bus-disconnected" },
    });
    await expect(queue.next()).resolves.toEqual({
      done: false,
      value: { type: "snapshot", revision: 3, data: { id: "fresh" } },
    });
  });

  it("shares one close operation, clears buffers, and finishes pending reads", async () => {
    const gate = deferred();
    const onClose = jest.fn(() => gate.promise);
    const queue = new LiveSubscriptionQueue(serializer, onClose);
    queue.pushSnapshot(1, serializer.stringify("discarded"));
    const close = queue.close();
    const duplicateClose = queue.close();
    expect(duplicateClose).toBe(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([close, duplicateClose]);
    await expect(queue.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    const pendingQueue = new LiveSubscriptionQueue(
      serializer,
      async () => undefined,
    );
    const pending = pendingQueue.next();
    await pendingQueue.close();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it("finishes pending reads even when close cleanup fails", async () => {
    const failure = new Error("close failed");
    const queue = new LiveSubscriptionQueue(serializer, async () => {
      throw failure;
    });
    const pending = queue.next();
    const close = queue.close();
    await expect(close).rejects.toBe(failure);
    await expect(queue.close()).rejects.toBe(failure);
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it("returns through the async-iterator cleanup contract", async () => {
    const onClose = jest.fn(async () => undefined);
    const queue = new LiveSubscriptionQueue(serializer, onClose);
    await expect(queue.return()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects pending and future reads after failure", async () => {
    const failure = new Error("refresh failed");
    const pendingQueue = new LiveSubscriptionQueue(
      serializer,
      async () => undefined,
    );
    const pending = pendingQueue.next();
    pendingQueue.fail(failure);
    await expect(pending).rejects.toBe(failure);
    await expect(pendingQueue.next()).rejects.toBe(failure);
    pendingQueue.fail(new Error("ignored"));
    pendingQueue.pushSnapshot(1, serializer.stringify("ignored"));

    const bufferedQueue = new LiveSubscriptionQueue(
      serializer,
      async () => undefined,
    );
    bufferedQueue.pushSnapshot(1, serializer.stringify("discarded"));
    bufferedQueue.fail(failure);
    await expect(bufferedQueue.next()).rejects.toBe(failure);
  });

  it("finishes idempotently and ignores later events", async () => {
    const controller = new AbortController();
    const onClose = jest.fn(async () => undefined);
    const queue = new LiveSubscriptionQueue(
      serializer,
      onClose,
      controller.signal,
    );
    const pending = queue.next();
    queue.finish();
    queue.finish();
    queue.pushStale();
    controller.abort();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await expect(queue.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles already-aborted and later-aborted signals", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const neverClosed = jest.fn(async () => undefined);
    const closedQueue = new LiveSubscriptionQueue(
      serializer,
      neverClosed,
      alreadyAborted.signal,
    );
    await expect(closedQueue.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await closedQueue.close();
    expect(neverClosed).not.toHaveBeenCalled();

    const controller = new AbortController();
    const onClose = jest.fn(async () => undefined);
    const queue = new LiveSubscriptionQueue(
      serializer,
      onClose,
      controller.signal,
    );
    const pending = queue.next();
    controller.abort();
    await flush();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("contains abort-listener cleanup failures", async () => {
    const controller = new AbortController();
    const queue = new LiveSubscriptionQueue(
      serializer,
      async () => {
        throw new Error("abort cleanup failed");
      },
      controller.signal,
    );
    controller.abort();
    await flush();
    await expect(queue.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
