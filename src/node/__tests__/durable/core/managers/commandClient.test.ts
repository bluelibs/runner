import { commandFixture } from "./command.helpers";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

describe("durable command clients", () => {
  it("times out only the caller, then returns the recovered receipt for the same request", async () => {
    const f = await commandFixture();
    f.kickoff.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(
      f.manager.command("run", f.command, 1, {
        idempotencyKey: "same",
        waitTimeoutMs: 10,
      }),
    ).rejects.toThrow("wait timed out");
    expect(await f.store.getNextCommand("run")).toMatchObject({
      status: "pending",
    });
    expect(
      await f.manager.command("run", f.command, 1, { idempotencyKey: "same" }),
    ).toBe(7);
    expect(
      await f.manager.command("run", f.command, 99, { idempotencyKey: "same" }),
    ).toBe(7);
  });

  it("follows continuations while keeping the request identity rooted at the caller's address", async () => {
    const f = await commandFixture(undefined, 2);
    await f.store.saveExecution(
      pendingExecution({
        id: "root",
        status: "continued_as_new",
        continuedAsExecutionId: "run",
      }),
    );
    expect(
      await f.manager.command("root", f.command, 1, {
        idempotencyKey: "request",
      }),
    ).toBe(7);
    expect(
      await f.store.getCommand(
        JSON.stringify(["root", f.command.id, "request"]),
      ),
    ).toMatchObject({ executionId: "run", requestedExecutionId: "root" });
  });

  it("rejects missing targets, undeclared commands, unsupported stores and disappearing receipts", async () => {
    const f = await commandFixture();
    await expect(f.manager.command("missing", f.command, 1)).rejects.toThrow(
      "does not exist",
    );
    await f.store.updateExecution("run", { workflowKey: "unknown" });
    await expect(f.manager.command("run", f.command, 1)).rejects.toThrow(
      "not declared",
    );
    await f.store.saveExecution(
      pendingExecution({ id: "unconfigured", workflowKey: "unconfigured" }),
    );
    f.tasks.register({ ...f.workflow, id: "unconfigured", tags: [] });
    await expect(
      f.manager.command("unconfigured", f.command, 1),
    ).rejects.toThrow("not declared");
    const custom = Object.create(f.store) as MemoryStore;
    Object.defineProperty(custom, "enqueueCommand", { value: undefined });
    f.config.store = custom;
    await expect(f.manager.command("run", f.command, 1)).rejects.toThrow(
      "atomic ownership",
    );
    f.config.store = f.store;
    await f.store.saveExecution(f.execution);
    f.kickoff.mockResolvedValueOnce(undefined);
    jest.spyOn(f.store, "getCommand").mockResolvedValue(null);
    await expect(f.manager.command("run", f.command, 1)).rejects.toThrow(
      "receipt disappeared",
    );
  });

  it("closes queued receipts when the target is cancelled and validates request options", async () => {
    const f = await commandFixture();
    f.kickoff.mockImplementationOnce(async () =>
      f.store.updateExecution("run", { status: "cancelled" }),
    );
    await expect(f.manager.command("run", f.command, 1)).rejects.toThrow(
      "Target workflow is closed",
    );
    await expect(
      f.manager.command("run", f.command, 1, { idempotencyKey: "" }),
    ).rejects.toThrow();
    await expect(
      f.manager.command("run", f.command, 1, { waitTimeoutMs: 0 }),
    ).rejects.toThrow();
  });
});
