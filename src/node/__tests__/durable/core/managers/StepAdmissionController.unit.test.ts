import {
  createExecutionLockState,
  markExecutionLockLost,
} from "../../../../durable/core/managers/ExecutionManager.locking";
import { StoreAdmissionController } from "../../../../durable/core/managers/StoreAdmissionController";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { parseStepConcurrency } from "../../../../durable/core/managers/StepAdmissionController";
import { durableExecutionInvariantError } from "../../../../../errors";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";
import { stepFixture } from "../durable-context/stepConcurrency.helpers";

const invalidPolicies: unknown[] = [
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  "1",
  null,
  { limit: 0 },
  { limit: 1, key: "" },
  { limit: 1, key: 7 },
  { max: 1, windowMs: 0 },
  { max: -1, windowMs: 1000 },
  { limit: 1, max: 1, windowMs: 1000 },
  {},
];

describe("durable: step concurrency contract", () => {
  it.each(invalidPolicies)(
    "rejects invalid concurrency policy %j",
    (policy) => {
      // @ts-expect-error Runtime input still needs validation when callers bypass TypeScript.
      expect(() => parseStepConcurrency(policy)).toThrow();
    },
  );

  it("validates even on cached replay, before touching store locks", async () => {
    const { ctx, replay, store } = await stepFixture();
    await ctx.step("charge", async () => 42);
    const acquire = jest.spyOn(store, "acquireLock");
    await expect(
      replay().step("charge", { concurrency: 0 }, async () => 0),
    ).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each([1, { windowMs: 1000, max: 1 }])(
    "fails fast with a typed error for unsupported stores: %j",
    async (concurrency) => {
      const { store } = await stepFixture();
      const ctx = new DurableContext(
        createBareStore(store),
        new MemoryEventBus(),
        "execution",
        1,
      );
      const error: unknown = await ctx
        .step("charge", { concurrency }, async () => 42)
        .catch((failure: unknown) => failure);
      expect(durableExecutionInvariantError.is(error)).toBe(true);
      expect(error).toMatchObject({
        message: expect.stringContaining("does not implement acquireLock()"),
      });
    },
  );

  it("requires a persisted workflow key when the pool key is omitted", async () => {
    const { ctx, store } = await stepFixture();
    await store.updateExecution("execution", { workflowKey: "" });
    await expect(
      ctx.step("charge", { concurrency: 1 }, async () => 42),
    ).rejects.toThrow("requires a persisted workflow key");
  });

  it("allows an explicit key without needing the execution's workflow key", async () => {
    const { ctx, store } = await stepFixture();
    await store.updateExecution("execution", { workflowKey: "" });
    await expect(
      ctx.step(
        "charge",
        { concurrency: { key: "shared", limit: 1 } },
        async () => 42,
      ),
    ).resolves.toBe(42);
  });

  it("does not run the body when the retry timer cannot be persisted", async () => {
    const { ctx, store } = await stepFixture();
    jest.spyOn(store, "acquireLock").mockResolvedValue(null);
    jest.spyOn(store, "createTimer").mockRejectedValue(new Error("store down"));
    const body = jest.fn(async () => 42);
    await expect(
      ctx.step("charge", { concurrency: 1, retries: 3 }, body),
    ).rejects.toThrow("store down");
    expect(body).not.toHaveBeenCalled();
  });
});

it("cannot commit using a valid slot when another attempt lock has been lost", async () => {
  const { store } = await stepFixture();
  const state = createExecutionLockState();
  const controller = new StoreAdmissionController(store, "step");
  const admission = await controller.tryAdmit({
    key: "pool",
    policy: 1,
    executionLockState: state,
  });
  expect(admission.kind).toBe("admitted");
  if (admission.kind === "admitted") {
    markExecutionLockLost(state, "execution");
    await expect(admission.assertOwnership()).rejects.toThrow("lock lost");
    await admission.release();
  }
});
