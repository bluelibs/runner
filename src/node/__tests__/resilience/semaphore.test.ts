import {
  RedisResilience,
  type ResilienceRedisClient,
} from "../../resilience/RedisResilience";
import type { ResilienceSemaphoreConfig } from "../../../globals/resilience/types";

function setup() {
  const redis: ResilienceRedisClient = {
    eval: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue("PONG"),
    disconnect: jest.fn(),
  };
  const backend = new RedisResilience(redis, {
    namespace: "test",
    redis: "unused",
    leaseMs: 90,
  });
  return { redis, backend };
}

const invalidConfigs: ResilienceSemaphoreConfig[] = [
  { key: "", limit: 1 },
  { key: "pool", limit: 0 },
  // @ts-expect-error Invalid external input must also fail at runtime.
  { key: "pool", limit: "1" },
  { key: "pool", limit: 1.5 },
  { key: "pool", limit: 1, maxQueue: -1 },
  { key: "pool", limit: 1, maxQueue: Infinity },
  { key: "pool", limit: 1, waitTimeoutMs: -1 },
  { key: "pool", limit: 1, waitTimeoutMs: 2_147_483_648 },
];

it.each(invalidConfigs)(
  "rejects invalid pool configuration before contacting Redis: %j",
  (config) => {
    const { redis, backend } = setup();
    expect(() => backend.semaphore(config)).toThrow();
    expect(redis.eval).not.toHaveBeenCalled();
  },
);

it("creates reusable lazy handles and snapshots caller-owned configuration", async () => {
  const { redis, backend } = setup();
  const config = { key: "pool", limit: 2, maxQueue: 0, waitTimeoutMs: 0 };
  const semaphore = backend.semaphore(config);
  expect(redis.eval).not.toHaveBeenCalled();
  config.key = "changed";
  config.limit = 9;
  try {
    await expect(
      semaphore.withPermit(async (signal) => {
        expect(signal.aborted).toBe(false);
        return 42;
      }),
    ).resolves.toBe(42);
    await expect(semaphore.withPermit(async () => "again")).resolves.toBe(
      "again",
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.any(String),
      expect.any(String),
      "acquire",
      2,
      expect.any(String),
      90,
    );
    expect(redis.eval).not.toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.any(String),
      expect.any(String),
      "acquire",
      9,
      expect.any(String),
      90,
    );
  } finally {
    await backend.dispose();
  }
});

it("releases permits after callback rejection and synchronous throws", async () => {
  const { redis, backend } = setup();
  const semaphore = backend.semaphore({ key: "pool", limit: 1 });
  try {
    await expect(
      semaphore.withPermit(async () => {
        throw new Error("async failure");
      }),
    ).rejects.toThrow("async failure");
    await expect(
      semaphore.withPermit(() => {
        throw new Error("sync failure");
      }),
    ).rejects.toThrow("sync failure");
    expect(redis.eval).toHaveBeenCalledTimes(4);
  } finally {
    await backend.dispose();
  }
});

it("rejects pre-cancelled calls without running work", async () => {
  const { redis, backend } = setup();
  const caller = new AbortController();
  caller.abort(new Error("cancelled"));
  const callback = jest.fn();
  try {
    await expect(
      backend
        .semaphore({ key: "pool", limit: 1 })
        .withPermit(callback, { signal: caller.signal }),
    ).rejects.toThrow("cancelled");
    expect(callback).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  } finally {
    await backend.dispose();
  }
});

it("passes caller cancellation into running work", async () => {
  const { backend } = setup();
  const caller = new AbortController();
  try {
    await expect(
      backend.semaphore({ key: "pool", limit: 1 }).withPermit(
        async (signal) => {
          caller.abort(new Error("cancelled"));
          expect(signal.aborted).toBe(true);
          signal.throwIfAborted();
        },
        { signal: caller.signal },
      ),
    ).rejects.toThrow("cancelled");
  } finally {
    await backend.dispose();
  }
});

it("aborts the callback on lease loss", async () => {
  jest.useFakeTimers();
  const { redis, backend } = setup();
  jest
    .spyOn(redis, "eval")
    .mockImplementation(async (...args) => (args[4] === "renew" ? 0 : 1));
  let callbackSignal: AbortSignal | undefined;
  const pending = backend
    .semaphore({ key: "pool", limit: 1 })
    .withPermit((signal) => {
      callbackSignal = signal;
      return new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
  const rejected = pending.catch((error: unknown) => error);
  try {
    await jest.advanceTimersByTimeAsync(35);
    expect(await rejected).toMatchObject({
      message: expect.stringMatching(/ownership was lost/),
    });
    expect(callbackSignal?.aborted).toBe(true);
  } finally {
    await backend.dispose();
    jest.useRealTimers();
  }
});

it("resource disposal aborts active work and invalidates existing handles", async () => {
  const { backend } = setup();
  const semaphore = backend.semaphore({ key: "pool", limit: 1 });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let callbackSignal: AbortSignal | undefined;
  const pending = semaphore.withPermit((signal) => {
    callbackSignal = signal;
    entered();
    return new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
  const rejected = pending.catch((error: unknown) => error);
  await started;
  await backend.dispose();
  expect(await rejected).toMatchObject({
    message: expect.stringMatching(/disposing/),
  });
  expect(callbackSignal?.aborted).toBe(true);
  await expect(semaphore.withPermit(async () => "no")).rejects.toThrow(
    /disposing/,
  );
});
