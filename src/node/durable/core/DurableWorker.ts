import type { IDurableQueue, QueueMessage } from "./interfaces/queue";
import type { IDurableExecutionProcessor } from "./interfaces/service";
import { Logger } from "../../../models/Logger";
import { durableExecutionInvariantError } from "../../../errors";

/**
 * Durable queue consumer (worker process role).
 *
 * The worker listens to the durable queue and turns queue messages into
 * `processExecution(executionId)` calls on the service layer (`ExecutionManager`
 * behind `IDurableExecutionProcessor`). This is how "resume" work is distributed
 * horizontally: the store is the source of truth, the queue provides delivery.
 */
export class DurableWorker {
  private readonly logger: Logger;
  private started = false;

  constructor(
    private readonly service: IDurableExecutionProcessor,
    private readonly queue: IDurableQueue,
    logger?: Logger,
  ) {
    const baseLogger =
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.worker" });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.queue.consume(async (message) => {
        try {
          await this.handleMessage(message);
          await this.queue.ack(message.id);
        } catch (error) {
          let shouldRequeue = message.attempts < message.maxAttempts;

          if (!shouldRequeue) {
            const executionId = this.extractExecutionId(message.payload);
            if (executionId) {
              try {
                await this.service.failExecutionDeliveryExhausted(executionId, {
                  messageId: message.id,
                  attempts: message.attempts,
                  maxAttempts: message.maxAttempts,
                  errorMessage: this.extractErrorMessage(error),
                });
              } catch (terminalizationError) {
                shouldRequeue = true;
                try {
                  await this.logger.error(
                    "Durable worker failed to mark exhausted delivery as terminal.",
                    {
                      error: terminalizationError,
                      data: { messageId: message.id, executionId },
                    },
                  );
                } catch {
                  // Logging must not affect message acknowledgement flow.
                }
              }
            }
          }

          try {
            await this.logger.error(
              "Durable worker failed to process message.",
              {
                error,
                data: { messageId: message.id },
              },
            );
          } catch {
            // Logging must not affect message acknowledgement flow.
          }
          await this.queue.nack(message.id, shouldRequeue);
        }
      });
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.queue.cancelConsumer?.();
  }

  private async handleMessage(message: QueueMessage): Promise<void> {
    if (
      message.type !== "execute" &&
      message.type !== "resume" &&
      message.type !== "schedule"
    ) {
      durableExecutionInvariantError.throw({
        message: `Durable worker received unsupported message type '${String(message.type)}' for message '${message.id}'.`,
      });
    }

    const executionId = this.requireExecutionId(message);
    await this.service.processExecution(executionId);
  }

  private extractExecutionId(payload: unknown): string | null {
    if (payload && typeof payload === "object") {
      const value = (payload as { executionId?: unknown }).executionId;
      return typeof value === "string" ? value : null;
    }
    return null;
  }

  private requireExecutionId(message: QueueMessage): string {
    const executionId = this.extractExecutionId(message.payload);
    if (executionId) {
      return executionId;
    }

    return durableExecutionInvariantError.throw({
      message: `Durable worker received malformed ${message.type} message '${message.id}' without a string executionId.`,
    });
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

export async function initDurableWorker(
  service: IDurableExecutionProcessor,
  queue: IDurableQueue,
  logger?: Logger,
): Promise<DurableWorker> {
  const worker = new DurableWorker(service, queue, logger);
  await worker.start();
  return worker;
}
