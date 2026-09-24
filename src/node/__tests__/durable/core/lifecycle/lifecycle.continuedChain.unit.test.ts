import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";
import {
  createLifecycleManager,
  lifecycleExecution,
} from "../../helpers/lifecycle.test.helpers";

const workflowKey = "durable-tests-lifecycle-continued-chain";

async function seedChain(store: MemoryStore, tip: Partial<Execution>) {
  await store.saveExecution(
    lifecycleExecution({
      id: "root",
      workflowKey,
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    }),
  );
  await store.saveExecution(
    lifecycleExecution({
      id: "tip",
      workflowKey,
      status: ExecutionStatus.Sleeping,
      continuedFromExecutionId: "root",
      ...tip,
    }),
  );
}

/** Continues `tip` as `next` right before the first write that targets it. */
function continueTipOnFirstWrite(base: MemoryStore) {
  let continued = false;
  return createBareStore(base, {
    saveExecutionIfStatus: async (execution, expected) => {
      if (!continued && execution.id === "tip") {
        continued = true;
        const tip = (await base.getExecution("tip"))!;
        await base.createContinuedExecution({
          priorExecution: {
            ...tip,
            status: ExecutionStatus.ContinuedAsNew,
            continuedAsExecutionId: "next",
          },
          successorExecution: lifecycleExecution({
            id: "next",
            workflowKey,
            status: ExecutionStatus.Pending,
            continuedFromExecutionId: "tip",
          }),
        });
      }
      return base.saveExecutionIfStatus(execution, expected);
    },
  });
}

describe("durable: lifecycle operations follow the continuation chain", () => {
  it("cancels the live tip when addressed by the original id", async () => {
    const store = new MemoryStore();
    await seedChain(store, {});

    await createLifecycleManager({ store }).cancelExecution("root", "stop");

    expect((await store.getExecution("tip"))?.status).toBe(
      ExecutionStatus.Cancelled,
    );
    expect((await store.getExecution("root"))?.status).toBe(
      ExecutionStatus.ContinuedAsNew,
    );
  });

  it("follows a tip that continues while the cancel is in flight", async () => {
    const base = new MemoryStore();
    await seedChain(base, { status: ExecutionStatus.Running });
    const manager = createLifecycleManager({
      store: continueTipOnFirstWrite(base),
    });

    await manager.cancelExecution("root", "stop");

    expect((await base.getExecution("tip"))?.status).toBe(
      ExecutionStatus.ContinuedAsNew,
    );
    expect((await base.getExecution("next"))?.status).toBe(
      ExecutionStatus.Cancelled,
    );
  });

  it("pauses and resumes the live tip when addressed by the original id", async () => {
    const store = new MemoryStore();
    await seedChain(store, {});
    const manager = createLifecycleManager({ store });

    await manager.pauseExecution("root");
    expect((await store.getExecution("tip"))?.status).toBe(
      ExecutionStatus.Paused,
    );

    // Resume re-kicks the tip; no executor here, so only the status matters.
    await manager.resumeExecution("root").catch(() => undefined);
    expect((await store.getExecution("tip"))?.pausedFrom).toBeUndefined();
    expect((await store.getExecution("tip"))?.status).not.toBe(
      ExecutionStatus.Paused,
    );
  });

  it("follows a tip that continues while the pause is in flight", async () => {
    const base = new MemoryStore();
    await seedChain(base, { status: ExecutionStatus.Running });
    const manager = createLifecycleManager({
      store: continueTipOnFirstWrite(base),
    });

    await manager.pauseExecution("root");

    expect((await base.getExecution("next"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("rethrows store failures instead of following the chain", async () => {
    const base = new MemoryStore();
    await seedChain(base, {});
    let rootReads = 0;
    const store = createBareStore(base, {
      getExecution: async (id) => {
        if (id === "root" && ++rootReads === 1) {
          return genericError.throw({ message: "store-down" });
        }
        return base.getExecution(id);
      },
    });

    await expect(
      createLifecycleManager({ store }).pauseExecution("root"),
    ).rejects.toThrow("store-down");
    expect((await base.getExecution("tip"))?.status).toBe(
      ExecutionStatus.Sleeping,
    );
  });

  it("still rejects pause of a settled chain", async () => {
    const store = new MemoryStore();
    await seedChain(store, { status: ExecutionStatus.Completed });

    await expect(
      createLifecycleManager({ store }).pauseExecution("root"),
    ).rejects.toThrow('"tip"');
  });

  it("keeps unknown ids a quiet cancel no-op and a pause rejection", async () => {
    const manager = createLifecycleManager({ store: new MemoryStore() });

    await expect(manager.cancelExecution("missing")).resolves.toBeUndefined();
    await expect(manager.pauseExecution("missing")).rejects.toThrow(
      '"missing"',
    );
  });

  it("fails fast on a broken chain", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "root",
        workflowKey,
        status: ExecutionStatus.ContinuedAsNew,
      }),
    );

    await expect(
      createLifecycleManager({ store }).cancelExecution("root"),
    ).rejects.toThrow("without a successor link");
  });
});
