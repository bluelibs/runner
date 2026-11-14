import { commandFixture } from "./command.helpers";
import { cancellationError } from "../../../../../errors";
import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";

describe("owned command execution", () => {
  it("resumes staged state and effect checkpoints after a cooperative pause", async () => {
    let calls = 0;
    let attempts = 0;
    const f = await commandFixture(async (d) => {
      await d.step("effect", async () => ++calls);
      await d.replaceState({ n: 4 });
      if (++attempts === 1)
        throw cancellationError.new({ reason: "Execution paused" });
      return d.getState();
    });
    await f.enqueue();
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect(await f.store.getWorkflowState("run")).toBeNull();
    expect(await f.store.getNextCommand("run")).toMatchObject({
      stateInitialized: true,
      state: { value: { n: 4 } },
    });
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect(calls).toBe(1);
    expect(await f.store.getCommand("request")).toMatchObject({
      result: { n: 4 },
    });
  });

  it("parks paused requests and rejects closed, missing and undeclared targets", async () => {
    const f = await commandFixture();
    await f.enqueue();
    await f.store.updateExecution("run", { status: "paused" });
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getNextCommand("run"))?.status).toBe("pending");
    await f.store.updateExecution("run", { status: "cancelled" });
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("request"))?.status).toBe("failed");
    await f.store.saveExecution(f.execution);
    await f.enqueue("unknown");
    await f.manager.drain(
      f.execution,
      { ...f.workflow, tags: [] },
      f.store,
      f.lock,
    );
    expect((await f.store.getCommand("unknown"))?.error?.message).toContain(
      "no longer declared",
    );
    await f.enqueue("gone");
    const read = jest.spyOn(f.store, "getExecution").mockResolvedValue(null);
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("gone"))?.status).toBe("failed");
    read.mockRestore();
    await f.enqueue("no-executor");
    f.config.taskExecutor = undefined;
    await expect(
      f.manager.drain(f.execution, f.workflow, f.store, f.lock),
    ).rejects.toThrow("task executor");
  });

  it("fences writes after lock loss and leaves its head recoverable", async () => {
    let context!: IDurableContext;
    const f = await commandFixture(async (d) => {
      context = d;
      f.lock.lost = true;
      return d.replaceState({ late: true });
    });
    await f.enqueue();
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    await expect(context.replaceState({ late: true })).rejects.toThrow(
      "no longer active",
    );
    const lost = createExecutionLockState();
    lost.lost = true;
    lost.lossError = new Error("lost");
    await expect(
      f.manager.drain(f.execution, f.workflow, f.store, lost),
    ).rejects.toThrow("lost");
    expect((await f.store.getNextCommand("run"))?.status).toBe("running");
  });

  it("does not commit while a pause wins at either completion boundary", async () => {
    const f = await commandFixture(async () => {
      await f.store.updateExecution("run", { status: "paused" });
      return 7;
    });
    await f.enqueue();
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getNextCommand("run"))?.status).toBe("running");
    await f.store.saveExecution(f.execution);
    f.config.taskExecutor = { run: async () => 7 as never };
    const complete = jest
      .spyOn(f.store, "completeCommand")
      .mockImplementationOnce(async () => {
        await f.store.updateExecution("run", { status: "paused" });
        return false;
      });
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("handles receipt contention, cancellation, suspension and non-Error failures", async () => {
    const f = await commandFixture(async () => {
      throw "rejected";
    });
    await f.enqueue();
    jest.spyOn(f.store, "saveCommand").mockResolvedValueOnce(false);
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("request"))?.error?.message).toBe(
      "rejected",
    );
    await f.enqueue("suspended");
    f.config.taskExecutor = {
      run: async () => {
        throw new SuspensionSignal("step-concurrency");
      },
    };
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getNextCommand("run"))?.id).toBe("suspended");
    const abort = new AbortController();
    abort.abort("Execution paused");
    jest
      .spyOn(f.cancellation, "registerAttemptCancellation")
      .mockResolvedValueOnce({ signal: abort.signal, stop() {} });
    f.config.taskExecutor = { run: async () => 7 as never };
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getNextCommand("run"))?.id).toBe("suspended");
    f.config.contextProvider = undefined;
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("suspended"))?.result).toBe(7);
  });
});
