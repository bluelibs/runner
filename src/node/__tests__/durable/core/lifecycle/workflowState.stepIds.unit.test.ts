import { DurableContext } from "../../../../durable/core/DurableContext";
import type { ImplicitInternalStepIdsPolicy } from "../../../../durable/core/durable-context/DurableContext.determinism";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
  type StepResult,
  type WorkflowState,
} from "../../../../durable/core/types";

const executionId = "workflow-state-ids";

function runningExecution(): Execution {
  return {
    id: executionId,
    workflowKey: "state-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function createContext(
  store: MemoryStore,
  implicitInternalStepIds: ImplicitInternalStepIdsPolicy = "allow",
): Promise<DurableContext> {
  await store.saveExecution(runningExecution());
  return new DurableContext(store, new MemoryEventBus(), executionId, 1, {
    implicitInternalStepIds,
  });
}

/**
 * Delays the first execution lookup so the first write's cancellation gate
 * settles after the second one's, and logs what each write persisted.
 */
class SlowFirstGateStore extends MemoryStore {
  readonly writes: string[] = [];
  private lookups = 0;

  async getExecution(id: string): Promise<Execution | null> {
    if (this.lookups++ === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return await super.getExecution(id);
  }

  async saveWorkflowState(state: WorkflowState): Promise<void> {
    this.writes.push(JSON.stringify(state.state));
    await super.saveWorkflowState(state);
  }

  async saveStepResult(result: StepResult): Promise<void> {
    this.writes.push(result.stepId);
    await super.saveStepResult(result);
  }
}

describe("durable: workflow state step ids", () => {
  it("applies the implicit step id policy to state calls", async () => {
    const ctx = await createContext(new MemoryStore(), "error");

    await expect(ctx.replaceState({ page: 1 })).rejects.toThrow(
      "DurableContext.replaceState() is using an implicit step id",
    );
    await expect(ctx.setState({ page: 1 })).rejects.toThrow(
      "DurableContext.setState() is using an implicit step id",
    );
    await expect(ctx.getState()).rejects.toThrow(
      "DurableContext.getState() is using an implicit step id",
    );
  });

  it("keys state calls by explicit step ids", async () => {
    const store = new MemoryStore();
    const ctx = await createContext(store, "error");

    await ctx.replaceState({ page: 1 }, { stepId: "init" });
    await ctx.setState({ page: 2 }, { stepId: "advance" });
    await expect(ctx.getState({ stepId: "check" })).resolves.toEqual({
      page: 2,
    });

    const stepIds = (await store.listStepResults(executionId)).map(
      (step) => step.stepId,
    );
    expect(stepIds.sort()).toEqual([
      "__state:advance",
      "__state:check",
      "__state:init",
    ]);
  });

  it("assigns write ids in call order even when gates settle out of order", async () => {
    const store = new SlowFirstGateStore();
    const ctx = await createContext(store);

    await Promise.all([
      ctx.replaceState({ page: 1 }),
      ctx.replaceState({ page: 2 }),
    ]);

    expect(store.writes).toEqual([
      '{"page":2}',
      "__state:write:1",
      '{"page":1}',
      "__state:write:0",
    ]);
  });
});
