import { genericError } from "../../../errors";
import { RabbitMQEventLaneQueue } from "../../event-lanes/RabbitMQEventLaneQueue";

const rabbitUrl =
  process.env.EVENT_LANES_TEST_RABBIT_URL ??
  process.env.DURABLE_TEST_RABBIT_URL ??
  "amqp://localhost";
const shouldRun = process.env.EVENT_LANES_INTEGRATION === "1";

function createQueueName(prefix: string): string {
  const stamp = Date.now();
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}.${stamp}.${random}`;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw genericError.new({
        message: "Timed out waiting for RabbitMQ lane messages.",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

(shouldRun ? describe : describe.skip)(
  "event-lanes: RabbitMQEventLaneQueue real integration",
  () => {
    it("requeues once with nack(true), then acks successfully", async () => {
      const queueName = createQueueName("runner.event-lanes.integration");
      const dlqName = `${queueName}.dlq`;
      const queue = new RabbitMQEventLaneQueue({
        url: rabbitUrl,
        queue: {
          name: queueName,
          deadLetter: dlqName,
          quorum: true,
        },
        prefetch: 1,
      });

      const seenMessageIds: string[] = [];
      const seenPayloads: string[] = [];

      try {
        await queue.init();
        await queue.consume(async (message) => {
          seenMessageIds.push(message.id);
          seenPayloads.push(message.payload);

          if (seenMessageIds.length === 1) {
            await queue.nack(message.id, true);
            return;
          }

          await queue.ack(message.id);
        });

        await queue.enqueue({
          laneId: "tests-event-lanes-integration.lane",
          eventId: "tests-event-lanes-integration.event",
          payload: '{"ok":true}',
          source: { kind: "runtime", id: "tests-event-lanes-integration" },
          maxAttempts: 3,
        });

        await waitUntil(() => seenMessageIds.length === 2);

        expect(seenMessageIds[0]).toBe(seenMessageIds[1]);
        expect(seenPayloads).toEqual(['{"ok":true}', '{"ok":true}']);
      } finally {
        await queue.dispose();
      }
    }, 30_000);
  },
);
