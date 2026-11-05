import { randomUUID } from "node:crypto";
import { check, Match } from "../../../tools/check";
import { connectAmqplib } from "../../durable/optionalDeps/amqplib";
import { RabbitMQEventLaneQueue } from "../../event-lanes/RabbitMQEventLaneQueue";
import type {
  Channel,
  ChannelModel,
} from "../../queue/rabbitmq/RabbitMQTransport.types";
import { genericError } from "../../../errors";

type IntegrationChannel = Channel & {
  deleteQueue(name: string): Promise<unknown>;
};
const enabled = process.env.EVENT_LANES_INTEGRATION === "1";

(enabled ? describe : describe.skip)(
  "RabbitMQ concurrent delivery ownership",
  () => {
    it("settles overlapping logical duplicates without leaving an original unacknowledged", async () => {
      const name = `runner.delivery.${randomUUID()}`;
      const url = process.env.EVENT_LANES_TEST_RABBIT_URL ?? "amqp://localhost";
      // Optional dependency values enter through the concrete AMQP adapter boundary.
      const connection = (await connectAmqplib(url)) as ChannelModel;
      const publisher =
        (await connection.createChannel()) as IntegrationChannel;
      const queue = new RabbitMQEventLaneQueue({
        url,
        queue: { name },
        prefetch: 2,
      });
      let releaseFirst!: () => void;
      let secondStarted!: () => void;
      const firstBarrier = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondArrival = new Promise<void>((resolve) => {
        secondStarted = resolve;
      });
      let deliveries = 0;
      let completed = 0;
      try {
        await queue.init();
        await queue.consume(async (message) => {
          if (++deliveries === 1) await firstBarrier;
          else secondStarted();
          await queue.ack(message.id);
          completed += 1;
        });
        const raw = Buffer.from(
          JSON.stringify({
            id: "same-logical-id",
            laneId: "lane",
            eventId: "event",
            payload: "{}",
            source: { kind: "runtime", id: "tests" },
            attempts: 0,
          }),
        );
        publisher.sendToQueue(name, raw, { persistent: true });
        publisher.sendToQueue(name, raw, { persistent: true });
        await secondArrival;
        releaseFirst();
        const deadline = Date.now() + 5000;
        while (completed !== 2) {
          if (Date.now() > deadline)
            throw genericError.new({
              message: "Duplicate deliveries did not finish.",
            });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await queue.dispose();
        // Closing the consumer requeues any original whose ack hit the wrong delivery.
        const result = check(
          await publisher.checkQueue!(name),
          Match.ObjectIncluding({ messageCount: Number }),
        );
        expect(result.messageCount).toBe(0);
      } finally {
        releaseFirst();
        await queue.dispose();
        await publisher.deleteQueue(name);
        await publisher.close();
        await connection.close();
      }
    }, 15_000);
  },
);
