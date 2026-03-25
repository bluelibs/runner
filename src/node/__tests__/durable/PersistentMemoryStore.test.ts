import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentMemoryStore } from "../../durable/store/PersistentMemoryStore";
import type { Execution, Timer } from "../../durable/core/types";
import { Serializer } from "../../../serializer";

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

    const execution: Execution = {
      id: "write-failure",
      workflowKey: "workflow.write-failure",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    };

    await expect(store.saveExecution(execution)).rejects.toThrow(/disk-full/);
    expect(readFileSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalled();
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
