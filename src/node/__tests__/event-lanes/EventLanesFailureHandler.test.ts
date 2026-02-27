import { handleEventLaneConsumerFailure } from "../../event-lanes/EventLanesFailureHandler";
import { runtimeSource } from "../../../types/runtimeSource";

describe("EventLanesFailureHandler", () => {
  const baseMessage = {
    id: "m1",
    laneId: "lane.a",
    eventId: "event.a",
    payload: "{}",
    source: runtimeSource.runtime("tests"),
    createdAt: new Date(),
    attempts: 1,
    maxAttempts: 1,
  };

  it("normalizes primitive failures to Error and settles with nack(false)", async () => {
    const queue = {
      nack: jest.fn(async () => undefined),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane.a" },
        queue: {} as any,
      } as any,
      message: baseMessage,
      error: "primitive-error",
      logger: logger as any,
      delay: async () => undefined,
    });

    expect(queue.nack).toHaveBeenCalledWith("m1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("preserves Error instances when retrying", async () => {
    const queue = {
      nack: jest.fn(async () => undefined),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };
    const failure = new Error("retry-failure");

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane.a" },
        queue: {} as any,
        retryDelayMs: 0,
      } as any,
      message: {
        ...baseMessage,
        maxAttempts: 2,
      },
      error: failure,
      logger: logger as any,
      delay: async () => undefined,
    });

    expect(queue.nack).toHaveBeenCalledWith("m1", true);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed; message requeued for retry.",
      expect.objectContaining({
        error: failure,
      }),
    );
  });
});
