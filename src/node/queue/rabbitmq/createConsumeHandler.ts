import type { Channel, ConsumeMessage } from "./RabbitMQTransport.types";

type ConsumeChannel = Pick<Channel, "nack">;

type CreateConsumeHandlerOptions<TMessage> = {
  channel: ConsumeChannel;
  decode: (content: Buffer) => TMessage | null;
  resolveMessageId: (message: TMessage) => string | undefined;
  parseFailureLogMessage: string;
  handlerFailureLogMessage: string;
  reportError: (message: string, data: Record<string, unknown>) => void;
  normalizeError: (error: unknown) => Error;
  settleWithNack: (
    channel: ConsumeChannel,
    msg: ConsumeMessage,
    requeue: boolean,
  ) => void;
  messageMap: Map<string, ConsumeMessage>;
  handler: (message: TMessage) => Promise<void>;
};

export function createConsumeHandler<TMessage>({
  channel,
  decode,
  resolveMessageId,
  parseFailureLogMessage,
  handlerFailureLogMessage,
  reportError,
  normalizeError,
  settleWithNack,
  messageMap,
  handler,
}: CreateConsumeHandlerOptions<TMessage>) {
  return async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) {
      return;
    }

    let decoded: TMessage | null;
    try {
      decoded = decode(msg.content);
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

    messageMap.set(messageId, msg);
    try {
      await handler(decoded);
    } catch (error) {
      reportError(handlerFailureLogMessage, {
        error: normalizeError(error),
        messageId,
      });
      try {
        settleWithNack(channel, msg, false);
      } finally {
        messageMap.delete(messageId);
      }
    }
  };
}
