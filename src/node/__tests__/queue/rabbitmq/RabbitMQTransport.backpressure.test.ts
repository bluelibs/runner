import { RabbitMQTransport } from "../../../queue/rabbitmq/RabbitMQTransport";
import { genericError } from "../../../../errors";
import { createRabbitMQTestKit } from "./testkit";
import { waitForDrain } from "../../../queue/rabbitmq/waitForDrain";
import { RabbitMQPublisher } from "../../../queue/rabbitmq/RabbitMQPublisher";

describe("RabbitMQ publisher backpressure", () => {
  afterEach(() => jest.restoreAllMocks());

  function transport() {
    return new RabbitMQTransport({
      queue: { name: "backpressure" },
      publishConfirm: false,
      reconnect: { enabled: false },
      decode: () => null,
      resolveMessageId: () => undefined,
      throwNotInitialized: () => {
        throw genericError.new({ message: "not initialized" });
      },
      parseFailureLogMessage: "parse",
      handlerFailureLogMessage: "handler",
      logger: { error: async () => {} },
    });
  }

  it("waits for drain and removes its listener", async () => {
    const kit = createRabbitMQTestKit();
    kit.channel.sendToQueue.mockReturnValue(false);
    const queue = transport();
    await queue.init();
    let completed = false;
    const pending = queue.publish(Buffer.from("message")).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(kit.events.listenerCount("drain")).toBe(1);
    kit.events.emit("drain");
    await pending;
    expect(kit.events.listenerCount("drain")).toBe(0);
    await queue.dispose();
  });

  it("pauses subsequent publishers until the saturated channel drains", async () => {
    const kit = createRabbitMQTestKit();
    kit.channel.sendToQueue.mockReturnValueOnce(false);
    const queue = transport();
    await queue.init();
    const first = queue.publish(Buffer.from("first"));
    const second = queue.publish(Buffer.from("second"));
    await Promise.resolve();
    expect(kit.channel.sendToQueue).toHaveBeenCalledTimes(1);
    kit.events.emit("drain");
    await Promise.all([first, second]);
    expect(kit.channel.sendToQueue).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("refuses stale publishing and cleans up an already aborted drain", async () => {
    const kit = createRabbitMQTestKit();
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForDrain(kit.channel, controller.signal),
    ).rejects.toMatchObject({ id: "cancellation" });
    expect(kit.events.listenerCount("drain")).toBe(0);
    const publisher = new RabbitMQPublisher();
    publisher.close();
    await expect(
      publisher.publish(kit.channel, "queue", Buffer.from("stale"), {}, false),
    ).rejects.toMatchObject({ id: "cancellation" });
    expect(kit.channel.sendToQueue).not.toHaveBeenCalled();
  });

  it.each(["dispose", "disconnect"])(
    "ends a drain wait on %s",
    async (reason) => {
      const kit = createRabbitMQTestKit();
      kit.channel.sendToQueue.mockReturnValue(false);
      const queue = transport();
      await queue.init();
      const pending = queue.publish(Buffer.from("message"));
      const rejected = pending.catch((error: unknown) => error);
      if (reason === "dispose") await queue.dispose();
      else kit.events.emit("close");
      await expect(rejected).resolves.toMatchObject({ id: "cancellation" });
      expect(kit.events.listenerCount("drain")).toBe(0);
      await queue.dispose();
    },
  );
});
