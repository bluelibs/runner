import { Logger } from "../../../../../models/Logger";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { AttemptCancellationController } from "../../../../durable/core/managers/AttemptCancellationController";
import { ExecutionAttemptRunner } from "../../../../durable/core/managers/ExecutionAttemptRunner";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function createLogger(): Logger {
  return new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });
}

function runningExecution(): Execution {
  return {
    id: "root",
    workflowKey: "continue-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: ExecutionAttemptRunner continuation", () => {
  it("finalizes instead of continuing when the prior run already moved on", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...runningExecution(),
      status: ExecutionStatus.Paused,
    });
    const kickoffExecution = jest.fn(async () => undefined);
    const auditLogger = new AuditLogger({}, store);
    const runner = new ExecutionAttemptRunner({
      store,
      eventBus: new MemoryEventBus(),
      taskRegistry: new TaskRegistry(),
      auditLogger,
      cancellation: new AttemptCancellationController({
        store,
        logger: createLogger(),
        liveCancellationEventBus: null,
      }),
      notifyFinished: jest.fn(async () => undefined),
      startExecution: jest.fn(async () => "started"),
      getTaskWorkflowKey: () => "continue-task",
      assertTaskExecutorConfigured: () => undefined,
      persistence: {
        store,
        auditLogger,
        getTaskWorkflowKey: () => "continue-task",
        maxAttempts: 3,
        kickoffFailsafeDelayMs: 0,
        kickoffExecution,
      },
    });

    await runner.continueExecutionAsNew({
      runningExecution: runningExecution(),
      nextInput: { orderId: "o2" },
    });

    const prior = await store.getExecution("root");
    expect(prior?.status).toBe(ExecutionStatus.Paused);
    expect(prior?.continuedAsExecutionId).toBeUndefined();
    expect(kickoffExecution).not.toHaveBeenCalled();
  });
});
