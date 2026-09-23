import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import {
  DURABLE_EXECUTION_CONTROL_CHANNEL,
  DurableExecutionControlEventType,
  EXECUTION_PAUSED_ABORT_REASON,
} from "../../../../durable/core/managers/ExecutionManager.cancellation";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { IEventBus } from "../../../../durable/core/interfaces/bus";
import { sleepMs } from "../../../../durable/core/utils";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

// Stamp of the pause that a later attempt was resumed from.
const pausedAt = new Date(1_700_000_000_000);

function createManager(store: IDurableStore, eventBus?: IEventBus) {
  return new ExecutionManager(
    { store, eventBus },
    new TaskRegistry(),
    new AuditLogger({ enabled: false }, store),
    new WaitManager(store, eventBus),
  );
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-epoch",
    workflowKey: "durable-tests-pause-epoch",
    input: undefined,
    status: ExecutionStatus.Paused,
    pausedAt,
    pausedFrom: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function publishPauseRequested(bus: IEventBus, payload: unknown) {
  await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
    type: DurableExecutionControlEventType.PauseRequested,
    payload,
    timestamp: new Date(),
  });
}

describe("durable: pause aborts only hit attempts started before the pause", () => {
  it("spares an attempt resumed from the same pause when the re-issue races it", async () => {
    // The store still answers "paused" (read before the resume committed),
    // while the live attempt already started after resuming that pause.
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager(store);
    const resumedAttempt =
      await manager.cancellation.registerAttemptCancellation({
        executionId: "e-epoch",
        pausedAt,
      });

    await manager.pauseExecution("e-epoch");

    expect(resumedAttempt.signal.aborted).toBe(false);
    resumedAttempt.stop();
  });

  it("stamps live pause requests and filters them per attempt", async () => {
    const bus = new MemoryEventBus();
    const manager = createManager(new MemoryStore(), bus);
    await manager.startLiveCancellationListener();
    const resumedAttempt =
      await manager.cancellation.registerAttemptCancellation({
        executionId: "e-resumed",
        pausedAt,
      });
    const olderAttempt = await manager.cancellation.registerAttemptCancellation(
      { executionId: "e-older" },
    );

    for (const executionId of ["e-resumed", "e-older"]) {
      await publishPauseRequested(bus, {
        executionId,
        reason: EXECUTION_PAUSED_ABORT_REASON,
        pausedAtMs: pausedAt.getTime(),
      });
    }

    expect(resumedAttempt.signal.aborted).toBe(false);
    expect(olderAttempt.signal.aborted).toBe(true);
    resumedAttempt.stop();
    olderAttempt.stop();
    await manager.stopLiveCancellationListener();
  });

  it("treats unstamped pause requests as legacy and ignores malformed stamps", async () => {
    const bus = new MemoryEventBus();
    const manager = createManager(new MemoryStore(), bus);
    await manager.startLiveCancellationListener();
    const attempt = await manager.cancellation.registerAttemptCancellation({
      executionId: "e-legacy",
      pausedAt,
    });

    await publishPauseRequested(bus, {
      executionId: "e-legacy",
      reason: EXECUTION_PAUSED_ABORT_REASON,
      pausedAtMs: "not-a-number",
    });
    expect(attempt.signal.aborted).toBe(false);

    await publishPauseRequested(bus, {
      executionId: "e-legacy",
      reason: EXECUTION_PAUSED_ABORT_REASON,
    });
    expect(attempt.signal.aborted).toBe(true);
    attempt.stop();
    await manager.stopLiveCancellationListener();
  });

  it("spares a resumed attempt in the polling fallback", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager(store);
    const attempt = await manager.cancellation.registerAttemptCancellation({
      executionId: "e-epoch",
      pausedAt,
    });

    await sleepMs(350);

    expect(attempt.signal.aborted).toBe(false);
    attempt.stop();
  });
});
