import { r } from "../../../../../index";
import { initDurableService } from "../../../../durable/core/DurableService";
import { HistoryCollector } from "../../../../durable/core/HistoryCollector";
import {
  retentionDelay,
  collectionDeadline,
} from "../../../../durable/core/retention";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { Logger } from "../../../../../models/Logger";

describe("durable history maintenance", () => {
  afterEach(() => jest.useRealTimers());

  it("validates retention durations and collector tuning", () => {
    expect(retentionDelay()).toBeUndefined();
    expect(retentionDelay({ onComplete: "retain" })).toBeUndefined();
    expect(retentionDelay({ onComplete: "delete" })).toBe(0);
    expect(retentionDelay({ onComplete: { afterMs: 12 } })).toBe(12);
    expect(() =>
      retentionDelay({ onComplete: { afterMs: Infinity } }),
    ).toThrow();
    expect(() => retentionDelay({ onComplete: { afterMs: -1 } })).toThrow();
    expect(
      () =>
        new HistoryCollector(
          { store: new MemoryStore(), garbageCollection: { intervalMs: 0 } },
          new Logger({
            printThreshold: null,
            printStrategy: "pretty",
            bufferLogs: false,
          }),
        ),
    ).toThrow();
    const store = new MemoryStore();
    Object.defineProperty(store, "collectCompletedHistory", {
      value: undefined,
    });
    expect(
      () =>
        new HistoryCollector(
          { store, retention: { onComplete: "delete" } },
          new Logger({
            printThreshold: null,
            printStrategy: "pretty",
            bufferLogs: false,
          }),
        ),
    ).toThrow("requires store");
  });

  it("rejects per-start deletion on a custom store without collection support", async () => {
    const store = new MemoryStore();
    Object.defineProperty(store, "collectCompletedHistory", {
      value: undefined,
    });
    const task = r
      .task("work")
      .run(async () => "done")
      .build();
    const service = await initDurableService({
      store,
      polling: { enabled: false },
      taskExecutor: { run: async () => "done" as never },
    });
    try {
      await expect(
        service.start(task, undefined, { retention: { onComplete: "delete" } }),
      ).rejects.toThrow("requires store");
    } finally {
      await service.stop();
    }
  });

  it("runs bounded nonoverlapping passes and drains on stop", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();
    let finish!: (count: number) => void;
    const collect = jest
      .spyOn(store, "collectCompletedHistory")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const collector = new HistoryCollector(
      { store, garbageCollection: { intervalMs: 10, batchSize: 2 } },
      new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      }),
    );
    collector.start();
    collector.start();
    await jest.advanceTimersByTimeAsync(30);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledWith(expect.any(Date), 2);
    const stopped = collector.stop();
    finish(1);
    await stopped;
    collector.start();
    await jest.advanceTimersByTimeAsync(30);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("contains backend and diagnostic failures without changing workflow outcomes", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();
    jest
      .spyOn(store, "collectCompletedHistory")
      .mockRejectedValue(new Error("offline"));
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const log = jest
      .spyOn(logger, "error")
      .mockRejectedValue(new Error("logger offline"));
    const collector = new HistoryCollector(
      { store, garbageCollection: { intervalMs: 1 } },
      logger,
    );
    collector.start();
    await jest.advanceTimersByTimeAsync(1);
    expect(log).toHaveBeenCalled();
    await collector.stop();
  });

  it("permits manual collection with the background loop disabled", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();
    const collect = jest.spyOn(store, "collectCompletedHistory");
    const collector = new HistoryCollector(
      { store, garbageCollection: { enabled: false } },
      new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      }),
    );
    collector.start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(collect).not.toHaveBeenCalled();
    await collector.stop();
    const execution = {
      id: "test",
      workflowKey: "workflow",
      input: undefined,
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
      attempt: 1,
      maxAttempts: 1,
      retention: { onComplete: "delete" },
    } as const;
    expect(collectionDeadline(execution)).toBeUndefined();
  });
});
