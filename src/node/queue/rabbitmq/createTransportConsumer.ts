import { normalizeError } from "../../../tools/normalizeError";
import { createConsumeHandler } from "./createConsumeHandler";
import type { RabbitMQDeliveryTracker } from "./RabbitMQDeliveryTracker";
import type {
  Channel,
  RabbitMQTransportConfig,
} from "./RabbitMQTransport.types";

/** Keeps decoding and handler failures within the originating delivery scope. */
export function createTransportConsumer<T>(options: {
  channel: Channel;
  config: RabbitMQTransportConfig<T>;
  deliveries: RabbitMQDeliveryTracker<T>;
  handler: (message: T) => Promise<void>;
  reportError: (message: string, data: Record<string, unknown>) => void;
}) {
  const { channel, config, deliveries, handler, reportError } = options;
  const settle = (action: () => void, requeue: boolean) => {
    try {
      action();
    } catch (error) {
      reportError("RabbitMQ transport failed to nack message.", {
        error: normalizeError(error),
        requeue,
      });
    }
  };
  return createConsumeHandler({
    channel,
    decode: config.decode,
    resolveMessageId: config.resolveMessageId,
    parseFailureLogMessage: config.parseFailureLogMessage,
    reportError,
    normalizeError,
    settleWithNack: (targetChannel, raw, requeue) =>
      settle(() => targetChannel.nack(raw, false, requeue), requeue),
    deliver: (id, message, raw) =>
      deliveries.run(id, message, raw, channel, async () => {
        try {
          await handler(message);
        } catch (error) {
          reportError(config.handlerFailureLogMessage, {
            error: normalizeError(error),
            messageId: id,
          });
          settle(() => deliveries.nack(id, false), false);
        }
      }),
  });
}
