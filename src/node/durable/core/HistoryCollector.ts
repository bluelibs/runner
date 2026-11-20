import type { DurableServiceConfig } from "./interfaces/service";
import type { Logger } from "../../../models/Logger";
import { check, Match } from "../../../tools/check";
import { durableExecutionInvariantError } from "../../../errors";
import { receiptRetentionDelay, retentionDelay } from "./retention";

/** Lifecycle-owned bounded history collection; stores own atomic deletion. */
export class HistoryCollector {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;
  private readonly interval: number;
  private readonly batchSize: number;

  constructor(
    private readonly config: DurableServiceConfig,
    private readonly logger: Logger,
  ) {
    this.interval = config.garbageCollection?.intervalMs ?? 60_000;
    this.batchSize = config.garbageCollection?.batchSize ?? 100;
    check(this.interval, Match.Range({ min: 1, integer: true }));
    check(this.batchSize, Match.Range({ min: 1, integer: true }));
    if (
      retentionDelay(config.retention) !== undefined &&
      !config.store.collectCompletedHistory
    ) {
      durableExecutionInvariantError.throw({
        message:
          "Configured retention requires store.collectCompletedHistory().",
      });
    }
    if (
      receiptRetentionDelay(config.retention) !== undefined &&
      !config.store.collectExpiredReceipts
    ) {
      durableExecutionInvariantError.throw({
        message:
          "Configured receipts retention requires store.collectExpiredReceipts().",
      });
    }
  }

  start(): void {
    if (
      this.timer ||
      this.stopped ||
      this.config.garbageCollection?.enabled === false ||
      (!this.config.store.collectCompletedHistory &&
        !this.config.store.collectExpiredReceipts)
    )
      return;
    this.timer = setInterval(() => this.tick(), this.interval);
    this.timer.unref();
  }

  private tick(): void {
    if (this.active) return;
    this.active = this.collect().finally(() => {
      this.active = undefined;
    });
  }

  private async collect(): Promise<void> {
    const now = new Date();
    try {
      if (this.config.store.collectCompletedHistory) {
        await this.config.store.collectCompletedHistory(now, this.batchSize);
      }
      if (this.config.store.collectExpiredReceipts) {
        await this.config.store.collectExpiredReceipts(now, this.batchSize);
      }
    } catch (error) {
      // Maintenance failure must never change the successful business outcome.
      await this.logger
        .error("Durable history collection failed.", { error })
        .catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}
