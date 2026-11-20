import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { MemoryQueue } from "../../../../durable/queue/MemoryQueue";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";
import type { DurableCommandRecord } from "../../../../durable/core/interfaces/commands";
import { Logger } from "../../../../../models/Logger";

const request = (id: string): DurableCommandRecord => ({
  id,
  executionId: "run",
  requestedExecutionId: "run",
  taskKey: "change",
  input: 1,
  status: "pending",
  createdAt: new Date(),
});
const logger = () =>
  new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });

describe("command timer delivery", () => {
  it("releases its claim without deleting a new admission made during delivery", async () => {
    const store = new MemoryStore();
    const queue = new MemoryQueue();
    await store.saveExecution(pendingExecution({ id: "run" }));
    await store.enqueueCommand(request("one"));
    const [timer] = await store.getExecutionTimers("run");
    const finalize = jest.spyOn(store, "finalizeClaimedTimer");
    const release = jest.spyOn(store, "releaseTimerClaim");
    const enqueue = jest
      .spyOn(queue, "enqueue")
      .mockImplementation(async () => {
        await store.completeCommand({ ...request("one"), status: "failed" });
        await store.enqueueCommand(request("two"));
        return "delivery";
      });
    const service = new DurableService({
      store,
      queue,
      logger: logger(),
      timers: { enabled: false },
    });
    await service.handleTimer(timer);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(finalize).not.toHaveBeenCalled();
    expect(await store.getExecutionTimers("run")).toEqual([
      expect.objectContaining({
        id: timer.id,
        type: "retry",
        commandWakeup: true,
      }),
    ]);
    expect((await store.getNextCommand("run"))?.id).toBe("two");
    await store.completeCommand({ ...request("two"), status: "failed" });
    // An already fetched delivery is harmless after the final receipt commits.
    await service.handleTimer(timer);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await store.getExecutionTimers("run")).toEqual([]);
  });

  it("keeps one rescheduled wakeup after dispatch failure", async () => {
    const store = new MemoryStore();
    const queue = new MemoryQueue();
    await store.saveExecution(pendingExecution({ id: "run" }));
    await store.enqueueCommand(request("one"));
    const [timer] = await store.getExecutionTimers("run");
    const enqueue = jest
      .spyOn(queue, "enqueue")
      .mockRejectedValue(new Error("queue down"));
    const service = new DurableService({
      store,
      queue,
      logger: logger(),
      timers: { enabled: false },
    });
    await service.handleTimer(timer);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await store.getExecutionTimers("run")).toEqual([
      expect.objectContaining({ id: timer.id }),
    ]);
    expect((await store.getNextCommand("run"))?.id).toBe("one");
  });

  it("logs invalid command timers and leaves their records available for inspection", async () => {
    const store = new MemoryStore();
    const log = logger();
    // The scoped logger shares this sink with its parent.
    const logs: unknown[] = [];
    log.onLog((entry) => {
      logs.push(entry);
    });
    const service = new DurableService({
      store,
      logger: log,
      timers: { enabled: false },
    });
    const timer = {
      id: "invalid",
      type: "retry" as const,
      commandWakeup: true as const,
      status: "pending" as const,
      fireAt: new Date(),
    };
    await store.createTimer(timer);
    await service.handleTimer(timer);
    expect(logs).toHaveLength(1);
    expect(await store.getReadyTimers(new Date(Date.now() + 1))).toEqual([
      timer,
    ]);
  });
});
