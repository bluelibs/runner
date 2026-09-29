import { acquireRedisPermit } from "../../resilience/acquirePermit";
import {
  middlewareConcurrencyQueueFullError,
  middlewareConcurrencyWaitTimeoutError,
} from "../../../errors";
import type { ConcurrencyWaitOptions } from "../../../globals/middleware/concurrency/wait";

function fixture() {
  const execute = jest
    .fn<Promise<boolean>, [string, string]>()
    .mockResolvedValue(false);
  const caller = new AbortController();
  const counts = new Map<string, number>();
  const start = (token: string, wait: ConcurrencyWaitOptions = {}) =>
    acquireRedisPermit(execute, token, 90, caller.signal, wait, {
      key: "pool",
      counts,
    });
  return { execute, caller, counts, start };
}

describe("Redis permit admission", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("caps waiters per pool and decrements rather than deleting other waiters", async () => {
    const value = fixture();
    const first = value
      .start("one", { maxQueue: 2 })
      .catch((error: unknown) => error);
    const second = value
      .start("two", { maxQueue: 2 })
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(0);
    expect(value.counts.get("pool")).toBe(2);
    const error = await value
      .start("three", { maxQueue: 2 })
      .catch((error: unknown) => error);
    expect(middlewareConcurrencyQueueFullError.is(error)).toBe(true);
    value.caller.abort(new Error("cancelled"));
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
    expect(value.counts.size).toBe(0);
  });

  it.each([{ maxQueue: 0 }, { waitTimeoutMs: 0 }])(
    "makes one attempt without retaining a waiter: %p",
    async (wait) => {
      const value = fixture();
      await expect(value.start("token", wait)).rejects.toThrow();
      expect(value.execute).toHaveBeenCalledTimes(1);
      expect(value.counts.size).toBe(0);
      value.execute.mockResolvedValueOnce(true);
      await expect(value.start("next", wait)).resolves.toBe(90);
    },
  );

  it("times out queued acquisition and restores capacity", async () => {
    const value = fixture();
    const failure = value
      .start("token", { waitTimeoutMs: 25 })
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(25);
    expect(middlewareConcurrencyWaitTimeoutError.is(await failure)).toBe(true);
    expect(value.counts.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("cleans up a timed-out grant arriving after the caller has returned", async () => {
    const value = fixture();
    let respond!: (granted: boolean) => void;
    value.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const failure = value
      .start("token", { waitTimeoutMs: 25 })
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(25);
    expect(middlewareConcurrencyWaitTimeoutError.is(await failure)).toBe(true);
    respond(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(value.execute).toHaveBeenLastCalledWith("release", "token");
    expect(value.counts.size).toBe(0);
  });

  it("bounds wait time even while the initial Redis request is pending", async () => {
    const value = fixture();
    let respond!: (granted: boolean) => void;
    value.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const failure = value
      .start("token", { waitTimeoutMs: 25 })
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(25);
    await failure;
    respond(false);
    await jest.advanceTimersByTimeAsync(0);
    expect(value.execute).toHaveBeenCalledTimes(1);
  });

  it("handles late failures and failed cleanup without unhandled rejections", async () => {
    const value = fixture();
    let reject!: (error: Error) => void;
    value.execute.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const failure = value.start("token").catch((error: unknown) => error);
    value.caller.abort(new Error("cancelled"));
    await failure;
    reject(new Error("Redis down"));
    await jest.advanceTimersByTimeAsync(0);
    expect(value.counts.size).toBe(0);
    const other = fixture();
    let respond!: (granted: boolean) => void;
    other.execute
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("disconnected"));
    const cancelled = other.start("token").catch((error: unknown) => error);
    other.caller.abort();
    await cancelled;
    respond(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(other.execute).toHaveBeenLastCalledWith("release", "token");
  });

  it("propagates backend errors and handles cancellation between grant and handoff", async () => {
    const value = fixture();
    value.execute.mockRejectedValueOnce(new Error("backend failed"));
    await expect(value.start("token")).rejects.toThrow("backend failed");
    const other = fixture();
    other.execute
      .mockImplementationOnce(() => {
        const granted = Promise.resolve(true);
        void granted.then(() => {
          void Promise.resolve().then(() =>
            other.caller.abort(new Error("cancelled")),
          );
        });
        return granted;
      })
      .mockImplementationOnce(() => new Promise(() => {}));
    const result = other.start("token").catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(0);
    expect(await result).toEqual(new Error("cancelled"));
    expect(other.execute).toHaveBeenLastCalledWith("release", "token");
    expect(other.counts.size).toBe(0);
  });

  it("allows unlimited waiting by default and frees the queue on admission", async () => {
    const value = fixture();
    value.execute.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const pending = value.start("token");
    await jest.advanceTimersByTimeAsync(30);
    await expect(pending).resolves.toBe(120);
    expect(value.counts.size).toBe(0);
  });
});
