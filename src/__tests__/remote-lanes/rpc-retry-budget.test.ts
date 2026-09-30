import { createRetryingRpcLaneCommunicator } from "../../remote-lanes/retry";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import {
  rpcLaneRetryPolicyInvalidInputError,
  rpcLaneRetryPolicyInvalidError,
} from "../../errors";
import { parseRetryAfterMs } from "../../remote-lanes/http/retryAfter";

describe("RPC retry safety and call budget", () => {
  afterEach(() => jest.useRealTimers());

  it("does not repeat a committed side effect after a lost response by default", async () => {
    let effects = 0;
    const task = jest.fn(async () => {
      effects += 1;
      throw new RemoteLaneTransportError("TIMEOUT", "response lost");
    });
    await expect(
      createRetryingRpcLaneCommunicator({ task }).task!("charge"),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(effects).toBe(1);
  });

  it("allows a custom classifier to retry an ordinary error", async () => {
    const task = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue("ok");
    await expect(
      createRetryingRpcLaneCommunicator(
        { task },
        { maxAttempts: 2, delayMs: 0, retryIf: () => true },
      ).task!("read"),
    ).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("provides remediation for an invalid lane-wide budget", () => {
    const error = rpcLaneRetryPolicyInvalidError.new({
      laneId: "lane",
      field: "totalTimeoutMs",
      value: "0",
    });
    expect(error.remediation).toContain("totalTimeoutMs");
  });

  it("bounds a custom communicator that ignores its cancellation signal", async () => {
    jest.useFakeTimers();
    const task = jest.fn(
      (_id: string, _input?: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBeDefined();
        return new Promise<never>(() => {});
      },
    );
    const wrapper = createRetryingRpcLaneCommunicator(
      { task },
      { totalTimeoutMs: 10, maxAttempts: 3 },
    );
    const rejection = wrapper.task!("read").catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(10);
    await expect(rejection).resolves.toMatchObject({
      code: "TIMEOUT",
      details: { timeoutMs: 10 },
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("honors server Retry-After without exceeding the overall budget", async () => {
    jest.useFakeTimers();
    const task = jest.fn(async () => {
      throw new RemoteLaneTransportError(
        "HTTP_ERROR",
        "overloaded",
        undefined,
        { httpCode: 503, retryAfterMs: 1000 },
      );
    });
    const wrapper = createRetryingRpcLaneCommunicator(
      { task },
      { maxAttempts: 3, delayMs: 0, totalTimeoutMs: 50 },
    );
    const rejection = wrapper.task!("read").catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(rejection).resolves.toMatchObject({ code: "TIMEOUT" });
    expect(task).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("waits for Retry-After when repeated execution is explicitly allowed", async () => {
    jest.useFakeTimers();
    const task = jest
      .fn()
      .mockRejectedValueOnce(
        new RemoteLaneTransportError("HTTP_ERROR", "overloaded", undefined, {
          httpCode: 429,
          retryAfterMs: 100,
        }),
      )
      .mockResolvedValue("ok");
    const wrapper = createRetryingRpcLaneCommunicator(
      { task },
      { maxAttempts: 2, delayMs: 0, totalTimeoutMs: 500 },
    );
    const pending = wrapper.task!("read");
    await jest.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("ok");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation and clears the overall timer", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const wrapper = createRetryingRpcLaneCommunicator(
      { task: async () => new Promise<never>(() => {}) },
      { totalTimeoutMs: 500 },
    );
    const rejection = wrapper.task!("read", undefined, {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    controller.abort();
    await expect(rejection).resolves.toMatchObject({ id: "cancellation" });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not start budgeted work for an already aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = jest.fn(async () => "ok");
    await expect(
      createRetryingRpcLaneCommunicator({ task }, { totalTimeoutMs: 50 }).task!(
        "read",
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ id: "cancellation" });
    expect(task).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])(
    "rejects invalid totalTimeoutMs %s",
    (totalTimeoutMs) => {
      expect(() =>
        createRetryingRpcLaneCommunicator({}, { totalTimeoutMs }),
      ).toThrow(
        rpcLaneRetryPolicyInvalidInputError.new({
          field: "totalTimeoutMs",
          value: String(totalTimeoutMs),
        }).message,
      );
    },
  );

  it("parses server delay seconds/dates and ignores malformed guidance", () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs(" ")).toBeUndefined();
    expect(parseRetryAfterMs("invalid")).toBeUndefined();
    expect(parseRetryAfterMs("-1")).toBeUndefined();
    expect(parseRetryAfterMs("1.5")).toBeUndefined();
    expect(parseRetryAfterMs("Monday, invalid")).toBeUndefined();
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(
      parseRetryAfterMs(
        "Wed, 21 Oct 2015 07:28:00 GMT",
        Date.parse("Wed, 21 Oct 2015 07:27:00 GMT"),
      ),
    ).toBe(60_000);
    expect(
      parseRetryAfterMs(
        "Wed, 21 Oct 2015 07:28:00 GMT",
        Date.parse("Wed, 21 Oct 2015 07:29:00 GMT"),
      ),
    ).toBe(0);
    expect(parseRetryAfterMs("9999999999")).toBe(2_147_483_647);
  });
});
