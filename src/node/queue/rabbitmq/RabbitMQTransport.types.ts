import type { Logger } from "../../../models/Logger";

export type ConsumeMessage = {
  content: Buffer;
  properties?: {
    headers?: Record<string, unknown>;
  };
};

export type Channel = {
  assertQueue: (
    queue: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  checkQueue?: (queue: string) => Promise<unknown>;
  prefetch: (count: number) => Promise<unknown>;
  sendToQueue: (
    queue: string,
    content: Buffer,
    options: Record<string, unknown>,
  ) => unknown;
  waitForConfirms?: () => Promise<unknown>;
  consume: (
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => Promise<void>,
  ) => Promise<unknown>;
  cancel: (consumerTag: string) => Promise<unknown>;
  ack: (msg: ConsumeMessage) => unknown;
  nack: (msg: ConsumeMessage, allUpTo?: boolean, requeue?: boolean) => unknown;
  close: () => Promise<unknown>;
  on?: (event: "close" | "error", handler: (error?: unknown) => void) => void;
};

export type ChannelModel = {
  createChannel: () => Promise<Channel>;
  createConfirmChannel?: () => Promise<Channel>;
  close: () => Promise<unknown>;
  on?: (event: "close" | "error", handler: (error?: unknown) => void) => void;
};

export interface RabbitMQTransportQueueConfig {
  name: string;
  quorum?: boolean;
  deadLetter?:
    | string
    | {
        queue?: string;
        exchange?: string;
        routingKey?: string;
      };
  messageTtl?: number;
  durable?: boolean;
  assert?: "active" | "passive";
  arguments?: Record<string, unknown>;
}

export interface RabbitMQTransportReconnectConfig {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface RabbitMQTransportConfig<TMessage> {
  url?: string;
  queue: RabbitMQTransportQueueConfig;
  prefetch?: number;
  publishOptions?: Record<string, unknown>;
  publishConfirm?: boolean;
  reconnect?: RabbitMQTransportReconnectConfig;
  logger?: Pick<Logger, "error">;
  parseFailureLogMessage: string;
  handlerFailureLogMessage: string;
  decode: (message: ConsumeMessage) => TMessage | null;
  resolveMessageId: (message: TMessage) => string | undefined;
  throwNotInitialized: () => never;
}

export const DEFAULT_RECONNECT: Required<RabbitMQTransportReconnectConfig> = {
  enabled: true,
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 2_000,
};

export type RabbitMQDeadLetterConfig = {
  queueName?: string;
  exchange?: string;
  routingKey?: string;
};

export function resolveDeadLetterConfig(
  deadLetter: RabbitMQTransportQueueConfig["deadLetter"],
): RabbitMQDeadLetterConfig {
  if (!deadLetter) {
    return {};
  }

  if (typeof deadLetter === "string") {
    return {
      queueName: deadLetter,
      exchange: "",
      routingKey: deadLetter,
    };
  }

  const queueName = deadLetter.queue;
  if (deadLetter.exchange !== undefined) {
    return {
      queueName,
      exchange: deadLetter.exchange,
      routingKey: deadLetter.routingKey,
    };
  }

  if (!queueName) {
    return {
      exchange: undefined,
      routingKey: deadLetter.routingKey,
    };
  }

  return {
    queueName,
    exchange: "",
    routingKey: deadLetter.routingKey ?? queueName,
  };
}

export function buildQueueArguments(
  queue: RabbitMQTransportQueueConfig,
  deadLetter: RabbitMQDeadLetterConfig,
): Record<string, unknown> {
  const argumentsMap: Record<string, unknown> = {
    ...(queue.arguments ?? {}),
  };

  if ((queue.quorum ?? true) && argumentsMap["x-queue-type"] === undefined) {
    argumentsMap["x-queue-type"] = "quorum";
  }
  if (deadLetter.exchange !== undefined) {
    argumentsMap["x-dead-letter-exchange"] = deadLetter.exchange;
  }
  if (deadLetter.routingKey !== undefined) {
    argumentsMap["x-dead-letter-routing-key"] = deadLetter.routingKey;
  }
  if (queue.messageTtl !== undefined) {
    argumentsMap["x-message-ttl"] = queue.messageTtl;
  }

  return argumentsMap;
}
