import { DurableContext } from "../../../../durable/core/DurableContext";
import {
  ContinuationSignal,
  SuspensionSignal,
} from "../../../../durable/core/interfaces/context";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { EXECUTION_PAUSED_ABORT_REASON } from "../../../../durable/core/pauseInterruption";
import { cancellationError } from "../../../../../errors";

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-control",
    workflowKey: "control-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function createContext(
  execution: Execution,
  cancellationSignal?: AbortSignal,
): Promise<{ ctx: DurableContext; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.saveExecution(execution);
  const ctx = new DurableContext(store, new MemoryEventBus(), execution.id, 1, {
    cancellationSignal,
  });
  return { ctx, store };
}

function isPauseInterruption(error: unknown): boolean {
  return cancellationError.is(error, { reason: EXECUTION_PAUSED_ABORT_REASON });
}

describe("durable: step control flow", () => {
  it("does not retry a step body that continues as new", async () => {
    const { ctx } = await createContext(createExecution());
    let bodyRuns = 0;

    const failure = await ctx
      .step("continue", { retries: 3 }, async () => {
        bodyRuns += 1;
        return await ctx.continueAsNew({ page: 2 });
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContinuationSignal);
    expect(bodyRuns).toBe(1);
  });

  it("does not retry a step body that suspends", async () => {
    const { ctx } = await createContext(createExecution());
    let bodyRuns = 0;

    const failure = await ctx
      .step("suspend", { retries: 3 }, async () => {
        bodyRuns += 1;
        throw new SuspensionSignal("sleep");
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SuspensionSignal);
    expect(bodyRuns).toBe(1);
  });

  it("refuses to start a step once the attempt signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(EXECUTION_PAUSED_ABORT_REASON);
    const { ctx } = await createContext(createExecution(), controller.signal);
    const body = jest.fn(async () => 1);

    const failure = await ctx.step("s1", body).catch((error: unknown) => error);

    expect(isPauseInterruption(failure)).toBe(true);
    expect(body).not.toHaveBeenCalled();
  });

  it("rejects new durable operations while paused", async () => {
    const { ctx } = await createContext(
      createExecution({ status: ExecutionStatus.Paused }),
    );
    const body = jest.fn(async () => 1);

    expect(
      isPauseInterruption(
        await ctx.step("s1", body).catch((error: unknown) => error),
      ),
    ).toBe(true);
    expect(
      isPauseInterruption(
        await ctx.continueAsNew({}).catch((error: unknown) => error),
      ),
    ).toBe(true);
    expect(body).not.toHaveBeenCalled();
  });

  it("still persists the result of a step that finished after the pause landed", async () => {
    const { ctx, store } = await createContext(createExecution());

    await expect(
      ctx.step("s1", async () => {
        const execution = await store.getExecution("e-control");
        await store.saveExecution({
          ...execution!,
          status: ExecutionStatus.Paused,
          pausedFrom: ExecutionStatus.Running,
          pausedAt: new Date(),
        });
        return 1;
      }),
    ).resolves.toBe(1);

    expect((await store.getStepResult("e-control", "s1"))?.result).toBe(1);
  });

  it("lets control-flow signals escape rollback without marking compensation failed", async () => {
    const { ctx, store } = await createContext(createExecution());
    await ctx
      .step("reserve")
      .up(async () => "reserved")
      .down(async () => {
        throw new ContinuationSignal({ next: true });
      });

    await expect(ctx.rollback()).rejects.toBeInstanceOf(ContinuationSignal);
    expect((await store.getExecution("e-control"))?.status).toBe(
      ExecutionStatus.Running,
    );
  });

  it("lets a pause interruption escape rollback without marking compensation failed", async () => {
    // Pause aborted the attempt, then a quick resume flipped the record back
    // to running before the rollback reached its compensation step.
    const controller = new AbortController();
    const { ctx, store } = await createContext(
      createExecution(),
      controller.signal,
    );
    const compensate = jest.fn(async () => {});
    await ctx
      .step("reserve")
      .up(async () => "reserved")
      .down(compensate);
    controller.abort(EXECUTION_PAUSED_ABORT_REASON);

    const failure = await ctx.rollback().catch((error: unknown) => error);

    expect(isPauseInterruption(failure)).toBe(true);
    expect(compensate).not.toHaveBeenCalled();
    expect((await store.getExecution("e-control"))?.status).toBe(
      ExecutionStatus.Running,
    );
  });
});
