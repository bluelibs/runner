import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { restartExecution } from "../../../../durable/core/managers/ExecutionManager.restart";
import { cancelExecution } from "../../../../durable/core/managers/ExecutionManager.terminal";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";
import { lifecycleExecution } from "../../helpers/lifecycle.test.helpers";

describe("durable: restart link vs concurrent cancel", () => {
  it("never regresses a source cancelled between the link read and its write", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      lifecycleExecution({
        id: "src",
        workflowKey: "wf",
        status: ExecutionStatus.Paused,
        pausedFrom: ExecutionStatus.Sleeping,
      }),
    );
    const auditLogger = new AuditLogger({ enabled: false }, base);
    let cancelInjected = false;
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (!cancelInjected && execution.restartedAsExecutionId) {
          cancelInjected = true;
          // The operator cancel lands after the link read its snapshot.
          await cancelExecution(
            {
              store: base,
              auditLogger,
              abortActiveAttempt: () => {},
              publishLiveCancellationRequested: async () => {},
              notifyFinished: async () => {},
            },
            "src",
            "stop",
          );
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });

    const restartedId = await restartExecution(
      {
        persistence: {
          store,
          auditLogger,
          getTaskWorkflowKey: () => "wf",
          maxAttempts: 1,
          kickoffFailsafeDelayMs: 0,
          kickoffExecution: async () => {},
        },
        resolveTask: () => undefined,
      },
      "src",
    );

    // The cancel stands; the link retries against the fresh (still
    // restartable) status instead of resurrecting the stale `paused` one.
    const source = await base.getExecution("src");
    expect(source?.status).toBe(ExecutionStatus.Cancelled);
    expect(source?.cancelledAt).toBeInstanceOf(Date);
    expect(source?.restartedAsExecutionId).toBe(restartedId);
    expect((await base.getExecution(restartedId))?.status).toBe(
      ExecutionStatus.Pending,
    );
  });
});

describe("durable: restart link convergence", () => {
  it("fails fast when the link keeps losing to status churn", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      lifecycleExecution({ id: "src", workflowKey: "wf" }),
    );
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) =>
        execution.restartedAsExecutionId
          ? false
          : base.saveExecutionIfStatus(execution, expected),
    });

    await expect(
      restartExecution(
        {
          persistence: {
            store,
            auditLogger: new AuditLogger({ enabled: false }, base),
            getTaskWorkflowKey: () => "wf",
            maxAttempts: 1,
            kickoffFailsafeDelayMs: 0,
            kickoffExecution: async () => {},
          },
          resolveTask: () => undefined,
        },
        "src",
      ),
    ).rejects.toThrow('to execution "src" after 5 attempts');
  });

  it("never sweeps a successor the source links to before the sweep", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      lifecycleExecution({
        id: "src",
        workflowKey: "wf",
        status: ExecutionStatus.Paused,
        pausedFrom: ExecutionStatus.Sleeping,
      }),
    );
    let successorId: string | undefined;
    let linkRejected = false;
    const store = createBareStore(base, {
      saveExecution: async (execution) => {
        await base.saveExecution(execution);
        if (execution.restartedFromExecutionId === "src") {
          successorId = execution.id;
          // The source resumes, so this caller's link is rejected ...
          await base.updateExecution("src", {
            status: ExecutionStatus.Sleeping,
          });
        }
      },
      getExecution: async (id) => {
        const execution = await base.getExecution(id);
        if (id !== "src" || !execution || !successorId) return execution;
        if (!linkRejected) {
          linkRejected = true;
          return execution;
        }
        // ... but another same-key caller linked it before the sweep read.
        return { ...execution, restartedAsExecutionId: successorId };
      },
    });

    await expect(
      restartExecution(
        {
          persistence: {
            store,
            auditLogger: new AuditLogger({ enabled: false }, base),
            getTaskWorkflowKey: () => "wf",
            maxAttempts: 1,
            kickoffFailsafeDelayMs: 0,
            kickoffExecution: async () => {},
          },
          resolveTask: () => undefined,
        },
        "src",
      ),
    ).rejects.toThrow('with status "sleeping"');
    expect((await base.getExecution(successorId!))?.status).toBe(
      ExecutionStatus.Pending,
    );
  });
});
