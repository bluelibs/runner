import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { bindEventLane } from "../../event-lanes";
import { r } from "../../..";

describe("event-lanes: MemoryEventLaneQueue", () => {
  it("bindEventLane returns frozen bindings", () => {
    const lane = r.eventLane("tests.event-lanes.binding.lane").build();
    const queue = new MemoryEventLaneQueue();
    const binding = bindEventLane({
      lane,
      queue,
    });

    expect(binding.queue).toBe(queue);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it("enqueues and consumes messages", async () => {
    const queue = new MemoryEventLaneQueue();
    const received: unknown[] = [];

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 1,
    });

    await queue.consume(async (message) => {
      received.push(message.payload);
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual(['{"x":1}']);
  });

  it("requeues on nack when attempts allow", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 2,
    });

    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      if (message.attempts === 1) {
        await queue.nack(message.id, true);
        return;
      }
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(attempts).toEqual([1, 2]);
  });

  it("does not requeue after max attempts", async () => {
    const queue = new MemoryEventLaneQueue();
    let calls = 0;

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 1,
    });

    await queue.consume(async (message) => {
      calls += 1;
      await queue.nack(message.id, true);
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(calls).toBe(1);
  });

  it("retries when handler throws and stops after success", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.throw",
      eventId: "event.throw",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 3,
    });

    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      if (message.attempts === 1) {
        throw new Error("fail once");
      }
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attempts).toEqual([1, 2]);
  });

  it("drops messages that are already beyond max attempts", async () => {
    const queue = new MemoryEventLaneQueue();
    const handler = jest.fn();

    await queue.enqueue({
      laneId: "lane.max-zero",
      eventId: "event.max-zero",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 0,
    });

    await queue.consume(async (message) => {
      handler(message);
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports no-op prefetch, unknown nacks, and dispose cleanup", async () => {
    const queue = new MemoryEventLaneQueue();
    await queue.setPrefetch(5);
    await queue.nack("missing-message");
    await queue.dispose();

    await queue.enqueue({
      laneId: "lane.dispose",
      eventId: "event.dispose",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 1,
    });

    const handler = jest.fn();
    await queue.consume(async (message) => {
      handler(message);
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not requeue thrown messages at max attempts", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.throw-max",
      eventId: "event.throw-max",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 1,
    });

    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      throw new Error("always fail");
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(attempts).toEqual([1]);
  });
});
