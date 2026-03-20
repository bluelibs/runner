import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";

describe("event-lanes: MemoryEventLaneQueue", () => {
  it("enqueues and consumes messages", async () => {
    const queue = new MemoryEventLaneQueue();
    const received: unknown[] = [];

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
    });

    await queue.consume(async (message) => {
      received.push(message.payload);
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual(['{"x":1}']);
  });

  it("requeues on nack when requested", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
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

  it("keeps requeue ownership outside the queue itself", async () => {
    const queue = new MemoryEventLaneQueue();
    let calls = 0;

    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
    });

    await queue.consume(async (message) => {
      calls += 1;
      if (calls === 1) {
        await queue.nack(message.id, true);
        return;
      }
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(calls).toBe(2);
  });

  it("does not auto-requeue uncaught handler failures", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.throw",
      eventId: "event.throw",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
    });

    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      throw new Error("fail once");
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attempts).toEqual([1]);
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
    });

    const handler = jest.fn();
    await queue.consume(async (message) => {
      handler(message);
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops processing after cooldown", async () => {
    const queue = new MemoryEventLaneQueue();
    const handler = jest.fn();

    await queue.enqueue({
      laneId: "lane.cooldown",
      eventId: "event.cooldown",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
    });

    await queue.consume(async (message) => {
      handler(message);
      await queue.ack(message.id);
    });
    await queue.cooldown();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("drops message permanently when nacked with requeue=false", async () => {
    const queue = new MemoryEventLaneQueue();
    const attempts: number[] = [];

    await queue.enqueue({
      laneId: "lane.nack-drop",
      eventId: "event.nack-drop",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
    });

    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      await queue.nack(message.id, false);
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(attempts).toEqual([1]);
  });
});
