import { Semaphore } from "../../../../models/Semaphore";
import { withMemoryPermit } from "../../../../globals/middleware/concurrency/memory";
import {
  middlewareConcurrencyQueueFullError,
  middlewareConcurrencyWaitTimeoutError,
  semaphoreDisposedError,
} from "../../../../errors";

const work = async () => "ok";

describe("in-memory concurrency admission", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("bounds waiting calls separately from running calls", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    const waiting = withMemoryPermit(
      semaphore,
      { maxQueue: 1 },
      undefined,
      work,
    );
    expect(semaphore.getWaitingCount()).toBe(1);
    const error = await withMemoryPermit(
      semaphore,
      { maxQueue: 1 },
      undefined,
      work,
    ).catch((error: unknown) => error);
    expect(middlewareConcurrencyQueueFullError.is(error)).toBe(true);
    semaphore.release();
    await expect(waiting).resolves.toBe("ok");
    expect(semaphore.getWaitingCount()).toBe(0);
    expect(semaphore.getAvailablePermits()).toBe(1);
  });

  it.each([{ maxQueue: 0 }, { waitTimeoutMs: 0 }])(
    "allows immediate work but never waits with %p",
    async (options) => {
      const semaphore = new Semaphore(1);
      await expect(
        withMemoryPermit(semaphore, options, undefined, work),
      ).resolves.toBe("ok");
      await semaphore.acquire();
      await expect(
        withMemoryPermit(semaphore, options, undefined, work),
      ).rejects.toThrow();
      expect(semaphore.getWaitingCount()).toBe(0);
      semaphore.release();
    },
  );

  it("times out admission without timing out running work", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    const failure = withMemoryPermit(
      semaphore,
      { waitTimeoutMs: 25 },
      undefined,
      work,
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(25);
    expect(middlewareConcurrencyWaitTimeoutError.is(await failure)).toBe(true);
    expect(semaphore.getWaitingCount()).toBe(0);
    semaphore.release();
    const running = withMemoryPermit(
      semaphore,
      { waitTimeoutMs: 1 },
      undefined,
      () => new Promise((resolve) => setTimeout(() => resolve("done"), 50)),
    );
    await jest.advanceTimersByTimeAsync(50);
    await expect(running).resolves.toBe("done");
  });

  it("removes cancelled waiters immediately and reclaims queue capacity", async () => {
    const semaphore = new Semaphore(1);
    const controller = new AbortController();
    await semaphore.acquire();
    const failure = withMemoryPermit(
      semaphore,
      { maxQueue: 1 },
      controller.signal,
      work,
    ).catch((error: unknown) => error);
    controller.abort();
    expect(semaphore.getWaitingCount()).toBe(0);
    expect(await failure).toBeInstanceOf(Error);
    const replacement = withMemoryPermit(
      semaphore,
      { maxQueue: 1 },
      undefined,
      work,
    );
    semaphore.release();
    await expect(replacement).resolves.toBe("ok");
    await expect(
      withMemoryPermit(semaphore, {}, controller.signal, work),
    ).rejects.toThrow();
  });

  it("releases a grant if cancellation wins before execution", async () => {
    const semaphore = new Semaphore(1);
    const controller = new AbortController();
    const acquire = semaphore.acquire.bind(semaphore);
    jest.spyOn(semaphore, "acquire").mockImplementationOnce(async () => {
      await acquire();
      controller.abort();
    });
    const run = jest.fn(work);
    await expect(
      withMemoryPermit(semaphore, {}, controller.signal, run),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(semaphore.getAvailablePermits()).toBe(1);
  });

  it("preserves disposal errors and releases failed executions", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      withMemoryPermit(semaphore, {}, undefined, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(semaphore.getAvailablePermits()).toBe(1);
    semaphore.dispose();
    const error = await withMemoryPermit(
      semaphore,
      { maxQueue: 0 },
      undefined,
      work,
    ).catch((error: unknown) => error);
    expect(semaphoreDisposedError.is(error)).toBe(true);
  });
});
