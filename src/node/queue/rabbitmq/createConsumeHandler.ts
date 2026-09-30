import type { Channel, ConsumeMessage } from "./RabbitMQTransport.types";

type ConsumeChannel = Pick<Channel, "nack">;

type CreateConsumeHandlerOptions<TMessage> = {
  channel: ConsumeChannel;
  decode: (message: ConsumeMessage) => TMessage | null;
  resolveMessageId: (message: TMessage) => string | undefined;
  parseFailureLogMessage: string;
  reportError: (message: string, data: Record<string, unknown>) => void;
  normalizeError: (error: unknown) => Error;
  settleWithNack: (
    channel: ConsumeChannel,
    msg: ConsumeMessage,
    requeue: boolean,
  ) => void;
  deliver: (
    id: string,
    message: TMessage,
    raw: ConsumeMessage,
  ) => Promise<void>;
};

export function createConsumeHandler<TMessage>({
  channel,
  decode,
  resolveMessageId,
  parseFailureLogMessage,
  reportError,
  normalizeError,
  settleWithNack,
  deliver,
}: CreateConsumeHandlerOptions<TMessage>) {
  return async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) {
      return;
    }

    let decoded: TMessage | null;
    try {
      decoded = decode(msg);
    } catch (error) {
      reportError(parseFailureLogMessage, {
        error: normalizeError(error),
        payload: msg.content.toString(),
      });
      settleWithNack(channel, msg, false);
      return;
    }

    if (!decoded) {
      settleWithNack(channel, msg, false);
      return;
    }

    const messageId = resolveMessageId(decoded);
    if (!messageId) {
      settleWithNack(channel, msg, false);
      return;
    }

    await deliver(messageId, decoded, msg);
  };
}
