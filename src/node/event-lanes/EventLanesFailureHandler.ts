import type { Logger } from "../../models/Logger";
import type { EventLanesResolvedBinding } from "./EventLanesInternals";
import type { EventLaneMessage } from "./types";

type EventLaneConsumerQueue = {
  nack(id: string, requeue?: boolean): Promise<void>;
};

type DelayFn = (ms: number) => Promise<void>;

type HandleEventLaneConsumerFailureInput = {
  queue: EventLaneConsumerQueue;
  binding: EventLanesResolvedBinding;
  message: EventLaneMessage;
  error: unknown;
  logger: Logger;
  delay: DelayFn;
};

export async function handleEventLaneConsumerFailure({
  queue,
  binding,
  message,
  error,
  logger,
  delay,
}: HandleEventLaneConsumerFailureInput): Promise<void> {
  const consumerError = toError(error);
  const configuredMaxAttempts = binding.maxAttempts ?? 1;

  const retried = await tryRetry({
    queue,
    binding,
    message,
    configuredMaxAttempts,
    error: consumerError,
    logger,
    delay,
  });
  if (retried) {
    return;
  }

  try {
    // Final settlement delegates dead-letter behavior to the queue/broker policy.
    await queue.nack(message.id, false);
  } finally {
    await logger.error("Event lane consumer failed.", {
      laneId: message.laneId,
      eventId: message.eventId,
      error: consumerError,
      data: {
        attempts: message.attempts,
        maxAttempts: configuredMaxAttempts,
      },
    });
  }
}

type RetryInput = {
  queue: EventLaneConsumerQueue;
  binding: EventLanesResolvedBinding;
  message: EventLaneMessage;
  configuredMaxAttempts: number;
  error: Error;
  logger: Logger;
  delay: DelayFn;
};

async function tryRetry({
  queue,
  binding,
  message,
  configuredMaxAttempts,
  error,
  logger,
  delay,
}: RetryInput): Promise<boolean> {
  const shouldRetry = message.attempts < configuredMaxAttempts;
  if (!shouldRetry) {
    return false;
  }

  const retryDelayMs = binding.retryDelayMs ?? 0;
  if (retryDelayMs > 0) {
    await delay(retryDelayMs);
  }

  await queue.nack(message.id, true);

  await logger.error(
    "Event lane consumer failed; message requeued for retry.",
    {
      laneId: message.laneId,
      eventId: message.eventId,
      error,
      data: {
        attempts: message.attempts,
        maxAttempts: configuredMaxAttempts,
        retryDelayMs,
      },
    },
  );
  return true;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
