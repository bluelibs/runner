import { r } from "../../../..";
import { stepFixture } from "./stepConcurrency.helpers";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";

describe("task step contracts", () => {
  it("requires an executor for task steps and a callable body for legacy option steps", async () => {
    const f = await stepFixture();
    const task = r
      .task("effect")
      .run(async () => 1)
      .build();
    await expect(f.ctx.step("task", task)).rejects.toThrow(
      "configured task executor",
    );
    expect(() => f.ctx.step("invalid", {}, undefined as never)).toThrow(
      "callback",
    );
    await expect(
      f.ctx.continueAsNew(undefined, { version: 0 }),
    ).rejects.toThrow();
  });

  it("stops a replayed continuation before inspecting or mutating the real execution", async () => {
    const f = await stepFixture();
    const effect = jest.fn((): never => {
      throw new Error("replay boundary");
    });
    const ctx = new DurableContext(
      f.store,
      new NoopEventBus(),
      "execution",
      1,
      { replay: { before() {}, after() {}, effect } },
    );
    await expect(ctx.continueAsNew(undefined)).rejects.toThrow(
      "replay boundary",
    );
    expect(effect).toHaveBeenCalledTimes(1);
    expect((await f.store.getExecution("execution"))?.status).toBe("running");
  });
});
