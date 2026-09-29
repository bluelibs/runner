import { withRedisPermit } from "../../resilience/permit";

function fixture(leaseMs = 90) {
  const execute = jest
    .fn<Promise<boolean>, [string, string]>()
    .mockResolvedValue(true);
  const shutdown = new AbortController();
  const caller = new AbortController();
  const abort = jest.fn();
  let finish!: (value: string) => void;
  const run = jest.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const start = () =>
    withRedisPermit({
      execute,
      leaseMs,
      signal: caller.signal,
      shutdown: shutdown.signal,
      abort,
      run,
    });
  return {
    execute,
    shutdown,
    caller,
    abort,
    run,
    start,
    finish: (value = "ok") => finish(value),
  };
}

function observeFailure(pending: Promise<unknown>): Promise<() => never> {
  return pending.then(
    () => {
      throw new Error("Expected permit rejection");
    },
    (error: unknown) => () => {
      throw error;
    },
  );
}

describe("distributed permit lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renews while active and releases after completion", async () => {
    const value = fixture();
    const pending = value.start();
    await jest.advanceTimersByTimeAsync(35);
    expect(value.execute.mock.calls.map(([operation]) => operation)).toEqual([
      "acquire",
      "renew",
    ]);
    value.finish();
    await expect(pending).resolves.toBe("ok");
    expect(value.execute).toHaveBeenLastCalledWith(
      "release",
      expect.any(String),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it("waits for capacity and cancels before admission", async () => {
    const value = fixture();
    value.execute.mockResolvedValue(false);
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(35);
    value.caller.abort(new Error("cancelled"));
    expect(await assertion).toThrow();
    expect(value.run).not.toHaveBeenCalled();
  });

  it("rejects already cancelled work without contacting Redis", async () => {
    const value = fixture();
    value.caller.abort(new Error("cancelled"));
    await expect(value.start()).rejects.toThrow("cancelled");
    expect(value.execute).not.toHaveBeenCalled();
  });

  it.each([false, new Error("Redis down"), "connection lost"])(
    "aborts on failed renewal: %p",
    async (failure) => {
      const value = fixture();
      value.execute.mockResolvedValueOnce(true);
      if (failure === false) value.execute.mockResolvedValueOnce(false);
      else value.execute.mockRejectedValueOnce(failure);
      const pending = value.start();
      const assertion = observeFailure(pending);
      await jest.advanceTimersByTimeAsync(35);
      expect(await assertion).toThrow();
      expect(value.abort).toHaveBeenCalledTimes(1);
      expect(value.execute).toHaveBeenLastCalledWith(
        "release",
        expect.any(String),
      );
      value.finish();
    },
  );

  it("checks ownership on completion before a renewal timer has fired", async () => {
    const value = fixture();
    value.execute.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(0);
    value.finish();
    expect(await assertion).toThrow(/expired before completion/);
  });

  it("stops on resource disposal even if user work ignores cancellation", async () => {
    const value = fixture();
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(0);
    value.shutdown.abort();
    expect(await assertion).toThrow(/disposing/);
    expect(value.abort).toHaveBeenCalledTimes(1);
    value.finish();
  });

  it("detects a renewal request that stalls past the local lease deadline", async () => {
    const value = fixture();
    let respond!: (value: boolean) => void;
    value.execute.mockResolvedValueOnce(true).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(95);
    expect(value.abort).toHaveBeenCalledTimes(1);
    respond(true);
    expect(await assertion).toThrow(/ownership was lost/);
    value.finish();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("does not start work after a delayed acquisition response outlives its lease", async () => {
    const value = fixture();
    value.execute.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 100)),
    );
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(100);
    expect(await assertion).toThrow(/expired before execution/);
    expect(value.run).not.toHaveBeenCalled();
    expect(value.execute).toHaveBeenLastCalledWith(
      "release",
      expect.any(String),
    );
  });

  it("rejects a completion check whose response outlives the renewed lease", async () => {
    const value = fixture();
    value.execute
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        jest.setSystemTime(Date.now() + 100);
        jest.spyOn(performance, "now").mockReturnValueOnce(1000);
        return true;
      });
    const pending = value.start();
    const assertion = observeFailure(pending);
    await jest.advanceTimersByTimeAsync(0);
    value.finish();
    expect(await assertion).toThrow(/expired before completion/);
    jest.restoreAllMocks();
  });
});
