import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentMemoryStore } from "../../durable/store/PersistentMemoryStore";
import type { Execution, Timer } from "../../durable/core/types";
import { Serializer } from "../../../serializer";

function createExecution(
  id: string,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "workflow.test",
    input: undefined,
    status: "pending",
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    ...overrides,
  };
}
describe("durable: PersistentMemoryStore", () => {
  let tempDirectory: string;
  let filePath: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(join(tmpdir(), "runner-durable-store-"));
    filePath = join(tempDirectory, "durable-state.json");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it("rehydrates durable state while discarding ephemeral locks", async () => {
    const firstStore = new PersistentMemoryStore({ filePath });
    await firstStore.init();

    const execution: Execution = {
      id: "persisted-execution",
      workflowKey: "workflow.persisted",
      input: { orderId: "order-1" },
      status: "sleeping",
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:01.000Z"),
    };

    const created = await firstStore.createExecutionWithIdempotencyKey({
      execution,
      workflowKey: execution.workflowKey,
      idempotencyKey: "order-1",
    });
    expect(created).toEqual({
      created: true,
      executionId: execution.id,
    });

    await firstStore.saveStepResult({
      executionId: execution.id,
      stepId: "remember",
      result: { memory: "sticky" },
      completedAt: new Date("2026-03-25T10:00:02.000Z"),
    });

    const timer: Timer = {
      id: "timer-1",
      executionId: execution.id,
      stepId: "nap",
      type: "sleep",
      fireAt: new Date(Date.now() + 60_000),
      status: "pending",
    };
    await firstStore.createTimer(timer);

    const lockId = await firstStore.acquireLock("schedule:sticky", 30_000);
    expect(lockId).not.toBeNull();

    await firstStore.dispose();

    const secondStore = new PersistentMemoryStore({ filePath });
    await secondStore.init();

    expect(await secondStore.getExecution(execution.id)).toEqual(execution);
    expect(await secondStore.getStepResult(execution.id, "remember")).toEqual({
      executionId: execution.id,
      stepId: "remember",
      result: { memory: "sticky" },
      completedAt: new Date("2026-03-25T10:00:02.000Z"),
    });
    expect(
      await secondStore.getReadyTimers(new Date(Date.now() + 120_000)),
    ).toEqual([timer]);

    const deduped = await secondStore.createExecutionWithIdempotencyKey({
      execution: {
        ...execution,
        id: "should-not-win",
      },
      workflowKey: execution.workflowKey,
      idempotencyKey: "order-1",
    });
    expect(deduped).toEqual({
      created: false,
      executionId: execution.id,
    });

    const recoveredLockId = await secondStore.acquireLock(
      "schedule:sticky",
      30_000,
    );
    expect(recoveredLockId).not.toBeNull();

    await secondStore.dispose();
  });

  it("treats missing snapshot sections as empty arrays", async () => {
    const serializer = new Serializer();
    await fs.writeFile(
      filePath,
      serializer.serialize({
        version: 1,
        executions: [],
      }),
      "utf8",
    );

    const store = new PersistentMemoryStore({ filePath });
    await store.init();
    await store.init();

    expect(await store.listExecutions()).toEqual([]);
    expect(await store.listSchedules()).toEqual([]);
    expect(
      await store.getReadyTimers(new Date("2026-03-25T10:00:00.000Z")),
    ).toEqual([]);

    await store.dispose();
  });

  it("fails fast for malformed or unsupported snapshots", async () => {
    const serializer = new Serializer();

    await fs.writeFile(filePath, serializer.serialize("nope"), "utf8");
    await expect(
      new PersistentMemoryStore({ filePath }).init(),
    ).rejects.toThrow(/top-level object/i);

    await fs.writeFile(filePath, serializer.serialize({ version: 2 }), "utf8");
    await expect(
      new PersistentMemoryStore({ filePath }).init(),
    ).rejects.toThrow(/unsupported version/i);

    await fs.writeFile(
      filePath,
      serializer.serialize({
        version: 1,
        executions: {},
      }),
      "utf8",
    );
    await expect(
      new PersistentMemoryStore({ filePath }).init(),
    ).rejects.toThrow(/executions.*array/i);
  });

  it("ignores dispose/flush calls before init and wraps file-write failures", async () => {
    const readFileSpy = jest
      .spyOn(fs, "readFile")
      .mockImplementation(async () => {
        const error = new Error("missing");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      });
    const writeFileSpy = jest
      .spyOn(fs, "writeFile")
      .mockRejectedValue("disk-full");
    const unlinkSpy = jest
      .spyOn(fs, "unlink")
      .mockRejectedValue(new Error("cleanup-failed"));
    jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    jest.spyOn(fs, "rename").mockResolvedValue(undefined);

    class ProbeStore extends PersistentMemoryStore {
      async flushWithoutInit(): Promise<void> {
        await this.afterDurableMutation(this.captureDurableMutationSnapshot());
      }
    }

    const store = new ProbeStore({ filePath });
    await store.dispose();
    await store.flushWithoutInit();
    await store.init();

    const execution = createExecution("write-failure", {
      workflowKey: "workflow.write-failure",
    });

    await expect(store.saveExecution(execution)).rejects.toThrow(/disk-full/);
    expect(readFileSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalled();
    expect(unlinkSpy).toHaveBeenCalled();
  });

  it("coalesces pending snapshots into a single follow-up write", async () => {
    const store = new PersistentMemoryStore({ filePath });
    await store.init();

    const originalWriteFile = fs.writeFile.bind(fs);
    let notifyFirstWriteStarted!: () => void;
    let releaseFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      notifyFirstWriteStarted = resolve;
    });
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const writeFileSpy = jest.spyOn(fs, "writeFile");
    let writeCount = 0;

    writeFileSpy.mockImplementation(async (...args) => {
      writeCount += 1;
      if (writeCount === 1) {
        notifyFirstWriteStarted();
        await firstWriteReleased;
      }

      return await originalWriteFile(...args);
    });

    const firstSave = store.saveExecution(
      createExecution("coalesce-first", { input: { order: 1 } }),
    );
    await firstWriteStarted;

    const secondExecution = createExecution("coalesce-second", {
      input: { order: 2 },
    });
    const thirdExecution = createExecution("coalesce-third", {
      input: { order: 3 },
    });

    const secondSave = store.saveExecution(secondExecution);
    const thirdSave = store.saveExecution(thirdExecution);
    releaseFirstWrite();

    await Promise.all([firstSave, secondSave, thirdSave]);
    await store.dispose();

    expect(writeFileSpy).toHaveBeenCalledTimes(2);

    const rehydratedStore = new PersistentMemoryStore({ filePath });
    await rehydratedStore.init();

    expect(await rehydratedStore.getExecution("coalesce-first")).toEqual(
      createExecution("coalesce-first", { input: { order: 1 } }),
    );
    expect(await rehydratedStore.getExecution(secondExecution.id)).toEqual(
      secondExecution,
    );
    expect(await rehydratedStore.getExecution(thirdExecution.id)).toEqual(
      thirdExecution,
    );

    await rehydratedStore.dispose();
  });

  it("starts a fresh write loop after a transient snapshot write failure", async () => {
    const store = new PersistentMemoryStore({ filePath });
    await store.init();

    const originalWriteFile = fs.writeFile.bind(fs);
    let shouldFailNextWrite = true;
    jest.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (shouldFailNextWrite) {
        shouldFailNextWrite = false;
        throw new Error("temporary-disk-glitch");
      }

      return await originalWriteFile(...args);
    });

    await expect(
      store.saveExecution(
        createExecution("queue-recovery-first", {
          workflowKey: "workflow.queue-recovery",
          input: { attempt: 1 },
        }),
      ),
    ).rejects.toThrow(/temporary-disk-glitch/);

    const recoveredExecution = createExecution("queue-recovery-second", {
      workflowKey: "workflow.queue-recovery",
      input: { attempt: 2 },
      updatedAt: new Date("2026-03-25T10:00:01.000Z"),
    });

    await expect(
      store.saveExecution(recoveredExecution),
    ).resolves.toBeUndefined();
    await store.dispose();

    const rehydratedStore = new PersistentMemoryStore({ filePath });
    await rehydratedStore.init();

    expect(await rehydratedStore.getExecution(recoveredExecution.id)).toEqual(
      recoveredExecution,
    );

    await rehydratedStore.dispose();
  });
});
