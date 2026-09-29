import { RabbitMQEventLaneQueue } from "../../event-lanes/RabbitMQEventLaneQueue";
import {
  createRabbitMQTestKit,
  eventLaneRawMessage,
} from "../queue/rabbitmq/testkit";

describe("RabbitMQ event lane delivery ownership", () => {
  afterEach(() => jest.restoreAllMocks());

  it("pins an externally initiated retry before its replacement arrives", async () => {
    const kit = createRabbitMQTestKit();
    const queue = new RabbitMQEventLaneQueue({
      queue: { name: "external-retry" },
    });
    await queue.init();
    await queue.consume(async () => {});
    const original = eventLaneRawMessage();
    await kit.deliver(original);
    let replacement!: { content: Buffer };
    kit.channel.sendToQueue.mockImplementation((_name, content) => {
      replacement = { content };
      void kit.deliver(replacement);
      return true;
    });
    await queue.nack("same-message", true);
    expect(kit.channel.ack).toHaveBeenCalledWith(original);
    await queue.ack("same-message");
    expect(kit.channel.ack.mock.calls[1][0]).toBe(replacement);
    await queue.dispose();
  });

  it.each(["ack", "nack"])(
    "keeps newer retry metadata when an older delivery uses %s",
    async (settlement) => {
      const kit = createRabbitMQTestKit();
      const queue = new RabbitMQEventLaneQueue({ queue: { name: "overlap" } });
      await queue.init();
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      const firstBarrier = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondBarrier = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const attempts: number[] = [];
      await queue.consume(async (message) => {
        attempts.push(message.attempts);
        if (message.attempts === 1) {
          await firstBarrier;
          if (settlement === "ack") await queue.ack(message.id);
          else await queue.nack(message.id, false);
        } else {
          if (message.attempts === 2) await secondBarrier;
          await queue.ack(message.id);
        }
      });
      const first = kit.deliver(eventLaneRawMessage());
      const second = kit.deliver(eventLaneRawMessage());
      releaseFirst();
      await first;
      await kit.deliver(eventLaneRawMessage());
      expect(attempts).toEqual([1, 2, 3]);
      releaseSecond();
      await second;
      expect(kit.channel.ack).toHaveBeenCalledTimes(
        settlement === "ack" ? 3 : 2,
      );
      expect(kit.channel.nack).toHaveBeenCalledTimes(
        settlement === "ack" ? 0 : 1,
      );
      await queue.dispose();
    },
  );

  it("ignores a retired channel's close event during recovery", async () => {
    const kit = createRabbitMQTestKit();
    const queue = new RabbitMQEventLaneQueue({
      queue: { name: "retired-channel" },
    });
    await queue.init();
    await queue.consume(async () => {});
    kit.channel.close.mockImplementation(async () => {
      kit.events.emit("close");
    });
    kit.channel.sendToQueue.mockImplementationOnce(() => {
      throw new Error("connection reset");
    });
    await queue.enqueue({
      laneId: "lane",
      eventId: "event",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
    });
    expect(kit.channel.consume).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("leaves missing or invalidated delivery ids unsettled", async () => {
    const kit = createRabbitMQTestKit();
    const queue = new RabbitMQEventLaneQueue({ queue: { name: "missing" } });
    await queue.init();
    await queue.ack("missing");
    await queue.nack("missing", false);
    await queue.nack("missing", true);
    expect(kit.channel.ack).not.toHaveBeenCalled();
    expect(kit.channel.nack).not.toHaveBeenCalled();
    expect(kit.channel.sendToQueue).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("logs handler settlement failure without rejecting the broker callback", async () => {
    const kit = createRabbitMQTestKit();
    kit.channel.nack.mockImplementation(() => {
      throw new Error("closed channel");
    });
    const log = jest.fn(async () => {});
    const queue = new RabbitMQEventLaneQueue({
      queue: { name: "handler-failure" },
      logger: { error: log },
    });
    await queue.init();
    await queue.consume(async () => {
      throw new Error("handler failed");
    });
    await expect(kit.deliver(eventLaneRawMessage())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "RabbitMQ transport failed to nack message.",
      expect.objectContaining({ requeue: false }),
    );
    await queue.dispose();
  });

  it("acks the original when a retry arrives before its publish confirmation", async () => {
    const kit = createRabbitMQTestKit();
    const queue = new RabbitMQEventLaneQueue({ queue: { name: "delivery" } });
    await queue.init();
    let releaseRetry!: () => void;
    const retryBarrier = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let retryPending: Promise<void>;
    kit.channel.sendToQueue.mockImplementation((_name, content) => {
      retryPending = kit.deliver({ content });
      return true;
    });
    kit.channel.waitForConfirms.mockImplementation(async () => {
      await Promise.resolve();
    });
    await queue.consume(async (message) => {
      if (message.attempts === 1) {
        await queue.nack(message.id, true);
      } else {
        await retryBarrier;
        await queue.ack(message.id);
      }
    });
    const original = eventLaneRawMessage();
    await kit.deliver(original);
    expect(kit.channel.ack).toHaveBeenCalledTimes(1);
    expect(kit.channel.ack).toHaveBeenCalledWith(original);
    releaseRetry();
    await retryPending!;
    expect(kit.channel.ack).toHaveBeenCalledTimes(2);
    expect(kit.channel.ack.mock.calls[1][0]).not.toBe(original);
    await queue.dispose();
  });

  it("does not let an old handler settle a redelivery after recovery", async () => {
    const kit = createRabbitMQTestKit();
    const queue = new RabbitMQEventLaneQueue({ queue: { name: "recovery" } });
    await queue.init();
    let releaseOld!: () => void;
    let oldStarted!: () => void;
    const oldBarrier = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    let deliveries = 0;
    await queue.consume(async (message) => {
      if (++deliveries === 1) {
        oldStarted();
        await oldBarrier;
      }
      await queue.ack(message.id);
    });
    const old = kit.deliver(eventLaneRawMessage());
    await started;
    kit.events.emit("close");
    // A public publish waits for the in-progress recovery to finish.
    await queue.enqueue({
      laneId: "lane",
      eventId: "event",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
    });
    const redelivery = eventLaneRawMessage();
    await kit.deliver(redelivery);
    releaseOld();
    await old;
    expect(kit.channel.ack).toHaveBeenCalledTimes(1);
    expect(kit.channel.ack).toHaveBeenCalledWith(redelivery);
    await queue.dispose();
  });
});
