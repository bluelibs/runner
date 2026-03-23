import { eventLanePayloadMalformedError } from "../../../errors";
import { handleEventLaneConsumerFailure } from "../../event-lanes/EventLanesFailureHandler";
import { runtimeSource } from "../../../types/runtimeSource";

describe("EventLanesFailureHandler", () => {
  const baseMessage = {
    id: "m1",
    laneId: "lane-a",
    eventId: "event.a",
    payload: "{}",
    source: runtimeSource.runtime("tests"),
    createdAt: new Date(),
    attempts: 1,
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
        lane: { id: "lane-a" },
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
        lane: { id: "lane-a" },
        queue: {} as any,
        retryDelayMs: 0,
        maxAttempts: 2,
      } as any,
      message: {
        ...baseMessage,
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

  it("applies retry delay before requeue", async () => {
    const order: string[] = [];
    const queue = {
      nack: jest.fn(async () => {
        order.push("nack");
      }),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };
    const delay = jest.fn(async () => {
      order.push("delay");
    });

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane-a" },
        queue: {} as any,
        retryDelayMs: 25,
        maxAttempts: 2,
      } as any,
      message: {
        ...baseMessage,
      },
      error: new Error("retry-with-delay"),
      logger: logger as any,
      delay,
    });

    expect(delay).toHaveBeenCalledWith(25);
    expect(queue.nack).toHaveBeenCalledWith("m1", true);
    expect(order).toEqual(["delay", "nack"]);
  });

  it("uses binding maxAttempts for retry decisions", async () => {
    const queue = {
      nack: jest.fn(async () => undefined),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane-a" },
        queue: {} as any,
        maxAttempts: 1,
      } as any,
      message: {
        ...baseMessage,
        attempts: 1,
      },
      error: new Error("should-not-retry"),
      logger: logger as any,
      delay: async () => undefined,
    });

    expect(queue.nack).toHaveBeenCalledWith("m1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed.",
      expect.objectContaining({
        data: expect.objectContaining({
          maxAttempts: 1,
        }),
      }),
    );
  });

  it("treats auth and assignment failures as permanent poison messages", async () => {
    const queue = {
      nack: jest.fn(async () => undefined),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane-a" },
        queue: {} as any,
        maxAttempts: 5,
      } as any,
      message: baseMessage,
      error: { id: "eventLanes-assignmentMismatch" },
      logger: logger as any,
      delay: async () => undefined,
    });

    expect(queue.nack).toHaveBeenCalledWith("m1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: 1,
          maxAttempts: 5,
        }),
      }),
    );
  });

  it("treats parse failures as permanent poison messages", async () => {
    const queue = {
      nack: jest.fn(async () => undefined),
    };
    const logger = {
      error: jest.fn(async () => undefined),
    };

    await handleEventLaneConsumerFailure({
      queue,
      binding: {
        lane: { id: "lane-a" },
        queue: {} as any,
        maxAttempts: 3,
      } as any,
      message: baseMessage,
      error: eventLanePayloadMalformedError.new({
        laneId: "lane-a",
        eventId: "event.a",
        reason: "deserialize failure",
      }),
      logger: logger as any,
      delay: async () => undefined,
    });

    expect(queue.nack).toHaveBeenCalledWith("m1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "eventLanes-payloadMalformed",
        }),
      }),
    );
  });
});
