import { r } from "../../../index";
import type { IResource } from "../../../defs";
import type { IDurableQueue, QueueMessage } from "./interfaces/queue";
import type { IDurableExecutionProcessor } from "./interfaces/service";
import { DurableService } from "./DurableService";

export class DurableWorker {
  static create(
    durableServiceResource: IResource<void, Promise<DurableService>>,
    config: { queue: IDurableQueue },
  ) {
    return createDurableWorkerResource(durableServiceResource, config);
  }

  constructor(
    private readonly service: IDurableExecutionProcessor,
    private readonly queue: IDurableQueue,
  ) {}

  async start(): Promise<void> {
    await this.queue.consume(async (message) => {
      try {
        await this.handleMessage(message);
        await this.queue.ack(message.id);
      } catch (error) {
        console.error(`Worker error processing message ${message.id}:`, error);
        await this.queue.nack(message.id, true);
      }
    });
  }

  private async handleMessage(message: QueueMessage): Promise<void> {
    const { type, payload } = message;

    if (type === "execute" || type === "resume" || type === "schedule") {
      const executionId = this.extractExecutionId(payload);
      if (executionId) {
        await this.service.processExecution(executionId);
      }
    }
  }

  private extractExecutionId(payload: unknown): string | null {
    if (payload && typeof payload === "object") {
      const value = (payload as { executionId?: unknown }).executionId;
      return typeof value === "string" ? value : null;
    }
    return null;
  }
}

export async function initDurableWorker(
  service: IDurableExecutionProcessor,
  queue: IDurableQueue,
): Promise<DurableWorker> {
  const worker = new DurableWorker(service, queue);
  await worker.start();
  return worker;
}

export function createDurableWorkerResource(
  durableServiceResource: IResource<void, Promise<DurableService>>,
  config: {
    queue: IDurableQueue;
  },
) {
  return r
    .resource<void>("durableWorker")
    .dependencies({ durableService: durableServiceResource })
    .init(async (_cfg, { durableService }) =>
      initDurableWorker(durableService, config.queue),
    )
    .build();
}
