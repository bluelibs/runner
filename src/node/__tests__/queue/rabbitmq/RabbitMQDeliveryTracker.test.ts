import { RabbitMQDeliveryTracker } from "../../../queue/rabbitmq/RabbitMQDeliveryTracker";
import { rabbitMQDeliveryAmbiguousError } from "../../../queue/rabbitmq/errors";
import { createRabbitMQTestKit, eventLaneRawMessage } from "./testkit";

describe("RabbitMQDeliveryTracker", () => {
  afterEach(() => jest.restoreAllMocks());

  it("settles concurrent logical duplicates independently and fails ambiguous external settlement", async () => {
    const { channel } = createRabbitMQTestKit();
    const tracker = new RabbitMQDeliveryTracker<{ attempt: number }>();
    const first = eventLaneRawMessage();
    const second = eventLaneRawMessage();
    await tracker.run("id", { attempt: 1 }, first, channel, async () => {});
    await tracker.run("id", { attempt: 2 }, second, channel, async () => {
      expect(tracker.getMessage("id")).toEqual({ attempt: 2 });
      tracker.nack("id", false);
      tracker.ack("id");
    });
    expect(channel.nack).toHaveBeenCalledWith(second, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(tracker.getMessage("id")).toEqual({ attempt: 1 });
    const third = eventLaneRawMessage();
    await tracker.run("id", { attempt: 3 }, third, channel, async () => {});
    expect(() => tracker.ack("id")).toThrow(
      rabbitMQDeliveryAmbiguousError.new({ messageId: "id" }).message,
    );
    tracker.clear();
    expect(tracker.getMessage("id")).toBeUndefined();
    tracker.ack("missing");
    tracker.nack("missing", true);
    const action = jest.fn(async () => {});
    await tracker.withDelivery("missing", action);
    expect(action).not.toHaveBeenCalled();
  });

  it("can settle one pending delivery after the consumer returns", async () => {
    const { channel } = createRabbitMQTestKit();
    const tracker = new RabbitMQDeliveryTracker<string>();
    const raw = eventLaneRawMessage();
    await tracker.run("id", "message", raw, channel, async () => {});
    tracker.ack("id");
    tracker.ack("id");
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(raw);
  });
});
