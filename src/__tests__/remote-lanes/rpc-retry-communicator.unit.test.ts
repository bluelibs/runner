import type { IRpcLaneCommunicator } from "../../defs";
import { cancellationError } from "../../errors";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import { createRetryingRpcLaneCommunicator } from "../../remote-lanes/retry";

function transportError(
  code: string,
  extras?: { httpCode?: number },
): RemoteLaneTransportError {
  return new RemoteLaneTransportError(code, `${code} failure`, undefined, {
    httpCode: extras?.httpCode,
  });
}

describe("createRetryingRpcLaneCommunicator", () => {
  it("forwards task, event, and eventWithResult calls with options", async () => {
    const task = jest.fn(async () => "remote-result");
    const event = jest.fn(async () => undefined);
    const eventWithResult = jest.fn(async () => ({ updated: true }));
    const wrapped = createRetryingRpcLaneCommunicator(
      { task, event, eventWithResult },
      { delayMs: 0 },
    );
    const signal = new AbortController().signal;
    const options = { headers: { "x-test": "1" }, signal };

    await expect(wrapped.task!("t", { a: 1 }, options)).resolves.toBe(
      "remote-result",
    );
    await expect(wrapped.event!("e", { b: 2 }, options)).resolves.toBe(
      undefined,
    );
    await expect(
      wrapped.eventWithResult!("e", { c: 3 }, options),
    ).resolves.toEqual({ updated: true });
    expect(task).toHaveBeenCalledWith("t", { a: 1 }, options);
    expect(event).toHaveBeenCalledWith("e", { b: 2 }, options);
    expect(eventWithResult).toHaveBeenCalledWith("e", { c: 3 }, options);
  });

  it("uses the default policy when omitted", async () => {
    const task = jest.fn(async () => "ok");
    const wrapped = createRetryingRpcLaneCommunicator({ task });

    await expect(wrapped.task!("t")).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("forwards calls without options", async () => {
    const task = jest.fn(async () => "ok");
    const wrapped = createRetryingRpcLaneCommunicator({ task }, { delayMs: 0 });

    await expect(wrapped.task!("t", { a: 1 })).resolves.toBe("ok");
    expect(task).toHaveBeenCalledWith("t", { a: 1 }, undefined);
  });

  it("exposes only the methods implemented by the inner communicator", () => {
    const taskOnly = createRetryingRpcLaneCommunicator({
      task: async () => "ok",
    });
    expect(typeof taskOnly.task).toBe("function");
    expect(taskOnly.event).toBe(undefined);
    expect(taskOnly.eventWithResult).toBe(undefined);

    const eventOnly = createRetryingRpcLaneCommunicator({
      event: async () => undefined,
    });
    expect(eventOnly.task).toBe(undefined);
    expect(typeof eventOnly.event).toBe("function");

    const empty = createRetryingRpcLaneCommunicator({} as IRpcLaneCommunicator);
    expect(empty.task).toBe(undefined);
    expect(empty.event).toBe(undefined);
    expect(empty.eventWithResult).toBe(undefined);
  });

  it("retries retryable failures until the call succeeds", async () => {
    const task = jest.fn(async () => {
      if (task.mock.calls.length < 3) {
        throw transportError("TIMEOUT");
      }
      return "recovered";
    });
    const wrapped = createRetryingRpcLaneCommunicator({ task }, { delayMs: 0 });

    await expect(wrapped.task!("t")).resolves.toBe("recovered");
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting maxAttempts", async () => {
    const failure = transportError("NETWORK_ERROR");
    const task = jest.fn(async () => {
      throw failure;
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { maxAttempts: 3, delayMs: 0 },
    );

    await expect(wrapped.task!("t")).rejects.toBe(failure);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable failures", async () => {
    const failure = transportError("HTTP_ERROR", { httpCode: 500 });
    const task = jest.fn(async () => {
      throw failure;
    });
    const wrapped = createRetryingRpcLaneCommunicator({ task }, { delayMs: 0 });

    await expect(wrapped.task!("t")).rejects.toBe(failure);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("disables retries when maxAttempts is 1", async () => {
    const task = jest.fn(async () => {
      throw transportError("TIMEOUT");
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { maxAttempts: 1, delayMs: 0 },
    );

    await expect(wrapped.task!("t")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("honors a custom retryIf that widens retries", async () => {
    const task = jest.fn(async () => {
      throw transportError("HTTP_ERROR", { httpCode: 500 });
    });
    const retryIf = jest.fn(() => true);
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { maxAttempts: 2, delayMs: 0, retryIf },
    );

    await expect(wrapped.task!("t")).rejects.toMatchObject({ httpCode: 500 });
    expect(task).toHaveBeenCalledTimes(2);
    expect(retryIf).toHaveBeenCalledTimes(2);
  });

  it("honors a custom retryIf that narrows retries", async () => {
    const task = jest.fn(async () => {
      throw transportError("TIMEOUT");
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { delayMs: 0, retryIf: () => false },
    );

    await expect(wrapped.task!("t")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("passes the zero-based retry index to function delays", async () => {
    const seenAttempts: number[] = [];
    const task = jest.fn(async () => {
      if (task.mock.calls.length < 3) {
        throw transportError("TIMEOUT");
      }
      return "ok";
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      {
        delayMs: (attempt, error) => {
          expect(error).toBeInstanceOf(RemoteLaneTransportError);
          seenAttempts.push(attempt);
          return 0;
        },
      },
    );

    await expect(wrapped.task!("t")).resolves.toBe("ok");
    expect(seenAttempts).toEqual([0, 1]);
  });

  it("waits between attempts when delayMs is positive", async () => {
    const task = jest.fn(async () => {
      if (task.mock.calls.length < 2) {
        throw transportError("TIMEOUT");
      }
      return "ok";
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { delayMs: 30 },
    );

    const startedAt = Date.now();
    await expect(wrapped.task!("t")).resolves.toBe("ok");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("waits between attempts when a caller signal is present", async () => {
    const task = jest.fn(async () => {
      if (task.mock.calls.length < 2) {
        throw transportError("TIMEOUT");
      }
      return "ok";
    });
    const wrapped = createRetryingRpcLaneCommunicator({ task }, { delayMs: 5 });
    const signal = new AbortController().signal;

    await expect(wrapped.task!("t", undefined, { signal })).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately when the caller aborts during the retry delay", async () => {
    const task = jest.fn(async () => {
      throw transportError("TIMEOUT");
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { delayMs: 5000 },
    );
    const controller = new AbortController();
    const pending = wrapped.task!("t", undefined, {
      signal: controller.signal,
    });

    setTimeout(() => controller.abort("test-cancelled"), 10);
    try {
      await pending;
      fail("should reject on abort");
    } catch (error) {
      expect(cancellationError.is(error)).toBe(true);
    }
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the caller signal is already aborted", async () => {
    const failure = transportError("TIMEOUT");
    const task = jest.fn(async () => {
      throw failure;
    });
    const wrapped = createRetryingRpcLaneCommunicator({ task }, { delayMs: 0 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      wrapped.task!("t", undefined, { signal: controller.signal }),
    ).rejects.toBe(failure);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
