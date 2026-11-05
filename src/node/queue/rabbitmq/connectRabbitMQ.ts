import { connectAmqplib } from "../../durable/optionalDeps/amqplib";
import { normalizeError } from "../../../tools/normalizeError";
import {
  buildQueueArguments,
  resolveDeadLetterConfig,
  DEFAULT_RECONNECT,
} from "./RabbitMQTransport.types";
import type {
  Channel,
  ChannelModel,
  RabbitMQTransportConfig,
  RabbitMQTransportReconnectConfig,
} from "./RabbitMQTransport.types";

/** Opens and declares one AMQP channel before publishers/consumers use it. */
export async function openRabbitMQChannel<T>(
  config: RabbitMQTransportConfig<T>,
  connected: (connection: ChannelModel, channel: Channel) => void,
): Promise<void> {
  const connection = (await connectAmqplib(
    config.url || "amqp://localhost",
  )) as ChannelModel;

  const shouldUseConfirmChannel = config.publishConfirm !== false;
  const canCreateConfirmChannel =
    typeof connection.createConfirmChannel === "function";
  const channel =
    shouldUseConfirmChannel && canCreateConfirmChannel
      ? await connection.createConfirmChannel!()
      : await connection.createChannel();

  connected(connection, channel);

  const durable = config.queue.durable ?? true;
  const assertMode = config.queue.assert ?? "active";
  const deadLetter = resolveDeadLetterConfig(config.queue.deadLetter);

  if (deadLetter.queueName) {
    if (assertMode === "passive") {
      await channel.checkQueue?.(deadLetter.queueName);
    } else {
      await channel.assertQueue(deadLetter.queueName, {
        durable,
      });
    }
  }

  const argumentsMap = buildQueueArguments(config.queue, deadLetter);

  if (assertMode === "passive") {
    await channel.checkQueue?.(config.queue.name);
  } else {
    await channel.assertQueue(config.queue.name, {
      durable,
      arguments: argumentsMap,
    });
  }
  await channel.prefetch(config.prefetch || 10);
}

/** Resolves the finite connection recovery policy. */
export function resolveReconnect(
  config: RabbitMQTransportReconnectConfig = {},
): Required<RabbitMQTransportReconnectConfig> {
  return {
    enabled: config.enabled ?? DEFAULT_RECONNECT.enabled,
    maxAttempts: config.maxAttempts ?? DEFAULT_RECONNECT.maxAttempts,
    initialDelayMs: config.initialDelayMs ?? DEFAULT_RECONNECT.initialDelayMs,
    maxDelayMs: config.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs,
  };
}

/** Retries connection setup without changing domain delivery policy. */
export async function setupRabbitMQWithRetry(options: {
  reconnect: Required<RabbitMQTransportReconnectConfig>;
  reason: string;
  setup: () => Promise<void>;
  disposed: () => boolean;
  report: (message: string, data: Record<string, unknown>) => void;
}): Promise<void> {
  const { reconnect, setup, disposed, report, reason } = options;
  const maxAttempts = reconnect.enabled ? reconnect.maxAttempts : 1;
  let delayMs = reconnect.initialDelayMs;
  let attempt = 0;
  while (true) {
    try {
      await setup();
      return;
    } catch (error) {
      attempt += 1;
      const normalizedError = normalizeError(error);
      if (attempt >= maxAttempts || disposed()) throw normalizedError;
      report("RabbitMQ transport connection attempt failed; retrying.", {
        reason,
        attempt,
        maxAttempts,
        delayMs,
        error: normalizedError,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, reconnect.maxDelayMs);
    }
  }
}
