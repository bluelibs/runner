import { EventEmitter } from "node:events";
import * as amqplib from "../../../durable/optionalDeps/amqplib";
import type {
  Channel,
  ConsumeMessage,
} from "../../../queue/rabbitmq/RabbitMQTransport.types";

export function createRabbitMQTestKit() {
  const events = new EventEmitter();
  let consumer: (raw: ConsumeMessage | null) => Promise<void>;
  const channel = {
    assertQueue: jest.fn(async () => undefined),
    prefetch: jest.fn(async () => undefined),
    sendToQueue: jest.fn(
      (_name: string, _body: Buffer, _options: Record<string, unknown>) => true,
    ),
    waitForConfirms: jest.fn(async () => undefined),
    consume: jest.fn(async (_name: string, handler: typeof consumer) => {
      consumer = handler;
      return { consumerTag: "test-consumer" };
    }),
    cancel: jest.fn(async () => undefined),
    ack: jest.fn((_message: ConsumeMessage) => undefined),
    nack: jest.fn(
      (_message: ConsumeMessage, _all?: boolean, _requeue?: boolean) =>
        undefined,
    ),
    close: jest.fn(async () => undefined),
    on: (
      event: "close" | "error" | "drain",
      handler: (error?: unknown) => void,
    ) => {
      events.on(event, handler);
    },
    removeListener: (
      event: "close" | "error" | "drain",
      handler: (error?: unknown) => void,
    ) => {
      events.removeListener(event, handler);
    },
  } satisfies Channel;
  jest.spyOn(amqplib, "connectAmqplib").mockResolvedValue({
    createChannel: async () => channel,
    createConfirmChannel: async () => channel,
    close: async () => undefined,
  });
  return { channel, events, deliver: (raw: ConsumeMessage) => consumer(raw) };
}

export function eventLaneRawMessage(id = "same-message"): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        id,
        laneId: "lane",
        eventId: "event",
        payload: "{}",
        attempts: 0,
        source: { kind: "runtime", id: "tests" },
      }),
    ),
  };
}
