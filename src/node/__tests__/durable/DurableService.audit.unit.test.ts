import { DurableService } from "../../durable/core/DurableService";
import { AuditLogger } from "../../durable/core/managers";
import type { DurableAuditEmitter } from "../../durable/core/audit";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  SpyQueue,
  createBareStore,
  okTask,
} from "./DurableService.unit.helpers";
import { createMessageError } from "../../../errors";

describe("durable: DurableService — audit (unit)", () => {
  it("skips audit persistence when audit is enabled but the store does not support it", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const service = new DurableService({
      store: createBareStore(base),
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    const task = okTask("t.audit.no-store-support");
    const executionId = await service.start(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);

    await expect(base.listAuditEntries(executionId)).resolves.toEqual([]);
  });

  it("does not fail executions when audit persistence throws", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const service = new DurableService({
      store: createBareStore(base, {
        appendAuditEntry: async () => {
          throw createMessageError("audit-write-failed");
        },
      }),
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    const task = okTask("t.audit.store-throws");
    const executionId = await service.start(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);
  });

  it("does not fail executions when audit emitter throws", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();

    const emitter: DurableAuditEmitter = {
      emit: async () => {
        throw createMessageError("audit-emitter-failed");
      },
    };

    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true, emitter },
      tasks: [],
    });

    const task = okTask("t.audit.emitter-throws");
    const executionId = await service.start(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);
  });

  it("swallows exceptions thrown while persisting audit entries", async () => {
    const base = new MemoryStore();

    const auditLogger = new AuditLogger(
      { enabled: true },
      createBareStore(base, {
        appendAuditEntry: async () => {
          throw createMessageError("audit-write-failed");
        },
      }),
    );

    await expect(
      auditLogger.log({
        kind: "execution_status_changed",
        executionId: "e1",
        attempt: 1,
        from: null,
        to: "pending",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows exceptions thrown by the audit emitter", async () => {
    const store = new MemoryStore();
    const emit = jest.fn(async () => {
      throw createMessageError("audit-emitter-failed");
    });

    const emitter: DurableAuditEmitter = { emit };
    const auditLogger = new AuditLogger({ enabled: true, emitter }, store);

    await expect(
      auditLogger.log({
        kind: "execution_status_changed",
        executionId: "e1",
        attempt: 1,
        from: null,
        to: "pending",
      }),
    ).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
