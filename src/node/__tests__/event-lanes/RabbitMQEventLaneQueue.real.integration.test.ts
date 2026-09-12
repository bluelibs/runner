import { genericError } from "../../../errors";
import { check, Match } from "../../../index";
import { RabbitMQEventLaneQueue } from "../../event-lanes/RabbitMQEventLaneQueue";

const rabbitUrl =
  process.env.EVENT_LANES_TEST_RABBIT_URL ??
  process.env.DURABLE_TEST_RABBIT_URL ??
  "amqp://localhost";
const shouldRun = process.env.EVENT_LANES_INTEGRATION === "1";
const shouldRunFaults =
  process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const managementUrl =
  process.env.RABBITMQ_MANAGEMENT_URL ?? "http://localhost:15672";
const managementUser = process.env.RABBITMQ_MANAGEMENT_USER ?? "guest";
const managementPassword = process.env.RABBITMQ_MANAGEMENT_PASSWORD ?? "guest";

const connectionListPattern = Match.ArrayOf(
  Match.ObjectIncluding({ name: String }),
);

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

async function listConnectionNames(): Promise<string[]> {
  const response = await fetch(`${managementUrl}/api/connections`, {
    headers: {
      authorization: `Basic ${Buffer.from(
        `${managementUser}:${managementPassword}`,
      ).toString("base64")}`,
    },
  });
  if (!response.ok) {
    return genericError.throw({
      message: `RabbitMQ management API returned ${response.status} while listing connections.`,
    });
  }

  const payload: unknown = JSON.parse(await response.text());
  const connections = check(payload, connectionListPattern);
  return connections.map((connection) => connection.name);
}

async function waitForNewConnection(
  existingNames: ReadonlySet<string>,
): Promise<string> {
  let newConnectionName: string | undefined;
  await waitUntil(async () => {
    newConnectionName = (await listConnectionNames()).find(
      (name) => !existingNames.has(name),
    );
    return newConnectionName !== undefined;
  });

  if (newConnectionName === undefined) {
    return genericError.throw({
      message: "RabbitMQ did not expose the queue connection.",
    });
  }
  return newConnectionName;
}

async function closeConnection(connectionName: string): Promise<void> {
  const response = await fetch(
    `${managementUrl}/api/connections/${encodeURIComponent(connectionName)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${managementUser}:${managementPassword}`,
        ).toString("base64")}`,
        "x-reason": "Runner real integration connection fault",
      },
    },
  );
  if (!response.ok) {
    return genericError.throw({
      message: `RabbitMQ management API returned ${response.status} while closing a connection.`,
    });
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

(shouldRunFaults ? describe : describe.skip)(
  "event-lanes: RabbitMQEventLaneQueue real recovery",
  () => {
    it("redelivers an unsettled message and resumes publishing after disconnect", async () => {
      const existingConnections = new Set(await listConnectionNames());
      const queueName = createQueueName("runner.event-lanes.recovery");
      const transportErrors: string[] = [];
      const queue = new RabbitMQEventLaneQueue({
        url: rabbitUrl,
        queue: { name: queueName, quorum: true },
        prefetch: 1,
        logger: {
          error: (message) => {
            transportErrors.push(String(message));
            return Promise.resolve();
          },
        },
        reconnect: {
          enabled: true,
          maxAttempts: 20,
          initialDelayMs: 50,
          maxDelayMs: 500,
        },
      });
      const deliveries: Array<{ id: string; payload: string }> = [];
      const acknowledgedIds = new Set<string>();

      try {
        await queue.init();
        await queue.consume(async (message) => {
          deliveries.push({ id: message.id, payload: message.payload });
          if (deliveries.length === 1) {
            return;
          }

          await queue.ack(message.id);
          acknowledgedIds.add(message.id);
        });
        const connectionName = await waitForNewConnection(existingConnections);

        const interruptedMessageId = await queue.enqueue({
          laneId: "tests-event-lanes-recovery.lane",
          eventId: "tests-event-lanes-recovery.interrupted",
          payload: '{"delivery":"interrupted"}',
          source: { kind: "runtime", id: "tests-event-lanes-recovery" },
        });
        await waitUntil(() => deliveries.length === 1);

        await closeConnection(connectionName);
        await waitUntil(() => acknowledgedIds.has(interruptedMessageId));

        expect(transportErrors).toContain(
          "RabbitMQ transport connection dropped.",
        );
        expect(deliveries.slice(0, 2)).toEqual([
          {
            id: interruptedMessageId,
            payload: '{"delivery":"interrupted"}',
          },
          {
            id: interruptedMessageId,
            payload: '{"delivery":"interrupted"}',
          },
        ]);

        const followUpMessageId = await queue.enqueue({
          laneId: "tests-event-lanes-recovery.lane",
          eventId: "tests-event-lanes-recovery.follow-up",
          payload: '{"delivery":"follow-up"}',
          source: { kind: "runtime", id: "tests-event-lanes-recovery" },
        });
        await waitUntil(() => acknowledgedIds.has(followUpMessageId));

        expect(deliveries[2]).toEqual({
          id: followUpMessageId,
          payload: '{"delivery":"follow-up"}',
        });
      } finally {
        await queue.dispose();
      }
    }, 45_000);
  },
);
