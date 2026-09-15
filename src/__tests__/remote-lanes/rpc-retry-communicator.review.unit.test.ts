import {
  cancellationError,
  rpcLaneRetryPolicyInvalidInputError,
} from "../../errors";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import { createRetryingRpcLaneCommunicator } from "../../remote-lanes/retry";

describe("createRetryingRpcLaneCommunicator review regressions", () => {
  it("preserves the communicator as each method receiver", async () => {
    const communicator = {
      prefix: "remote",
      async task(this: { prefix: string }, id: string) {
        return `${this.prefix}:task:${id}`;
      },
      async event(this: { prefix: string }, id: string) {
        expect(`${this.prefix}:event:${id}`).toBe("remote:event:e");
      },
      async eventWithResult(this: { prefix: string }, id: string) {
        return `${this.prefix}:event-result:${id}`;
      },
    };
    const wrapped = createRetryingRpcLaneCommunicator(communicator, {
      delayMs: 0,
    });

    await expect(wrapped.task!("t")).resolves.toBe("remote:task:t");
    await expect(wrapped.event!("e")).resolves.toBeUndefined();
    await expect(wrapped.eventWithResult!("er")).resolves.toBe(
      "remote:event-result:er",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
    "rejects invalid direct maxAttempts values: %s",
    (maxAttempts) => {
      try {
        createRetryingRpcLaneCommunicator(
          { task: async () => "ok" },
          { maxAttempts },
        );
        fail("should reject invalid maxAttempts");
      } catch (error) {
        expect(
          rpcLaneRetryPolicyInvalidInputError.is(error, {
            field: "maxAttempts",
            value: String(maxAttempts),
          }),
        ).toBe(true);
      }
    },
  );

  it.each([-1, Number.POSITIVE_INFINITY])(
    "rejects invalid direct delayMs values: %s",
    (delayMs) => {
      try {
        createRetryingRpcLaneCommunicator(
          { task: async () => "ok" },
          { delayMs },
        );
        fail("should reject invalid delayMs");
      } catch (error) {
        expect(
          rpcLaneRetryPolicyInvalidInputError.is(error, {
            field: "delayMs",
            value: String(delayMs),
          }),
        ).toBe(true);
        expect(error).toMatchObject({
          remediation: expect.stringContaining("non-negative"),
        });
      }
    },
  );

  it.each(["retryIf", "delayMs"])(
    "does not retry after %s aborts with zero delay",
    async (callback) => {
      const controller = new AbortController();
      const task = jest.fn(async () => {
        throw new RemoteLaneTransportError("TIMEOUT", "slow");
      });
      const wrapped = createRetryingRpcLaneCommunicator(
        { task },
        {
          delayMs: () => {
            if (callback === "delayMs") controller.abort("cancelled");
            return 0;
          },
          retryIf: () => {
            if (callback === "retryIf") controller.abort("cancelled");
            return true;
          },
        },
      );
      await expect(
        wrapped.task!("t", undefined, { signal: controller.signal }),
      ).rejects.toMatchObject({
        id: cancellationError.id,
      });
      expect(task).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects when abort wins the race before the delay listener is attached", async () => {
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads > 1;
      },
      reason: "race-cancelled",
      addEventListener: jest.fn((_type: string, listener: () => void) =>
        listener(),
      ),
      removeEventListener: jest.fn(),
    } as unknown as AbortSignal;
    const task = jest.fn(async () => {
      throw new RemoteLaneTransportError("TIMEOUT", "slow");
    });
    const wrapped = createRetryingRpcLaneCommunicator(
      { task },
      { delayMs: 100 },
    );

    try {
      await wrapped.task!("t", undefined, { signal });
      fail("should reject the raced abort");
    } catch (error) {
      expect(cancellationError.is(error)).toBe(true);
    }
    expect(signal.addEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true },
    );
    expect(signal.removeEventListener).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
