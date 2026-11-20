import { r } from "../../../../../index";
import { initDurableService } from "../../../../durable/core/DurableService";
import { HistoryCollector } from "../../../../durable/core/HistoryCollector";
import {
  retentionDelay,
  receiptRetentionDelay,
  receiptExpiryDeadline,
} from "../../../../durable/core/retention";
import { durableWorkflowTag } from "../../../../durable/tags/durableWorkflow.tag";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { Logger } from "../../../../../models/Logger";

describe("durable history maintenance: receipt retention", () => {
  afterEach(() => jest.useRealTimers());

  it("validates receipts retention schedules, tag configs, and store support", async () => {
    expect(receiptRetentionDelay()).toBeUndefined();
    expect(receiptRetentionDelay({ onComplete: "retain" })).toBeUndefined();
    expect(
      receiptRetentionDelay({ onComplete: "retain", receipts: "retain" }),
    ).toBeUndefined();
    expect(
      receiptRetentionDelay({ onComplete: "retain", receipts: "delete" }),
    ).toBe(0);
    expect(
      receiptRetentionDelay({
        onComplete: { afterMs: 100 },
        receipts: { afterMs: 500 },
      }),
    ).toBe(500);
    expect(() =>
      retentionDelay({
        onComplete: { afterMs: 500 },
        receipts: { afterMs: 100 },
      }),
    ).toThrow(/earlier than onComplete/i);
    expect(() =>
      durableWorkflowTag.with({
        retention: { onComplete: { afterMs: 500 }, receipts: { afterMs: 100 } },
      }),
    ).toThrow(/earlier than onComplete/i);

    const t0 = new Date("2025-01-01T00:00:00.000Z");
    const baseExec = {
      id: "r1",
      workflowKey: "wf",
      input: undefined,
      attempt: 1,
      maxAttempts: 1,
      createdAt: t0,
      updatedAt: t0,
      completedAt: t0,
    };
    expect(
      receiptExpiryDeadline({
        ...baseExec,
        status: "completed",
        retention: { onComplete: "retain", receipts: { afterMs: 250 } },
      }),
    ).toBe(t0.getTime() + 250);
    expect(
      receiptExpiryDeadline({
        ...baseExec,
        status: "failed",
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    ).toBeUndefined();

    const noReceiptStore = new MemoryStore();
    Object.defineProperty(noReceiptStore, "collectExpiredReceipts", {
      value: undefined,
    });
    const quietLogger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    expect(
      () =>
        new HistoryCollector(
          {
            store: noReceiptStore,
            retention: { onComplete: "retain", receipts: "delete" },
          },
          quietLogger,
        ),
    ).toThrow(/collectExpiredReceipts/);

    const task = r
      .task("work-receipts")
      .run(async () => "ok")
      .build();
    const durable = await initDurableService({
      store: noReceiptStore,
      polling: { enabled: false },
      taskExecutor: { run: async () => "ok" as never },
    });
    try {
      await expect(
        durable.start(task, undefined, {
          retention: { onComplete: "retain", receipts: "delete" },
        }),
      ).rejects.toThrow(/collectExpiredReceipts/);
    } finally {
      await durable.stop();
    }
  });

  it("handles stores with only history, only receipts, or neither collector", async () => {
    jest.useFakeTimers();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    const historyOnly = new MemoryStore();
    const historySpy = jest.spyOn(historyOnly, "collectCompletedHistory");
    Object.defineProperty(historyOnly, "collectExpiredReceipts", {
      value: undefined,
    });
    const c1 = new HistoryCollector(
      { store: historyOnly, garbageCollection: { intervalMs: 500 } },
      logger,
    );
    c1.start();
    await jest.advanceTimersByTimeAsync(500);
    expect(historySpy).toHaveBeenCalledTimes(1);
    await c1.stop();

    const receiptsOnly = new MemoryStore();
    const receiptSpy = jest.spyOn(receiptsOnly, "collectExpiredReceipts");
    Object.defineProperty(receiptsOnly, "collectCompletedHistory", {
      value: undefined,
    });
    const c2 = new HistoryCollector(
      { store: receiptsOnly, garbageCollection: { intervalMs: 500 } },
      logger,
    );
    c2.start();
    await jest.advanceTimersByTimeAsync(500);
    expect(receiptSpy).toHaveBeenCalledTimes(1);
    await c2.stop();

    const neitherStore = new MemoryStore();
    Object.defineProperty(neitherStore, "collectCompletedHistory", {
      value: undefined,
    });
    Object.defineProperty(neitherStore, "collectExpiredReceipts", {
      value: undefined,
    });
    const c3 = new HistoryCollector(
      { store: neitherStore, garbageCollection: { intervalMs: 500 } },
      logger,
    );
    c3.start();
    await c3.stop();
  });
});
