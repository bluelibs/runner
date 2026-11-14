import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";
import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";

describe("pinned workflow implementations", () => {
  it("upgrades explicitly at continuation and retains versions on restarts and schedules", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const v1 = r
      .task("checkout-one")
      .tags([tags.durableWorkflow.with({ key: "checkout", version: 1 })])
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) =>
        durable.use().continueAsNew(undefined, { version: 2 }),
      )
      .build();
    const v2 = r
      .task("checkout-two")
      .tags([tags.durableWorkflow.with({ key: "checkout", version: 2 })])
      .run(async () => "two")
      .build();
    await test.run(
      r
        .resource("app")
        .register([resources.durable, v1, v2, test.durableRegistration])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(v1);
      expect(await test.backend.wait(id)).toBe("two");
      const first = (await test.store.getExecution(id))!;
      expect(first.workflowVersion).toBe(1);
      expect(
        (await test.store.getExecution(first.continuedAsExecutionId!))
          ?.workflowVersion,
      ).toBe(2);
      const restarted = await test.backend.restartExecution(id, {
        idempotencyKey: "restart",
      });
      expect((await test.store.getExecution(restarted))?.workflowVersion).toBe(
        1,
      );
      expect(await test.backend.wait(restarted)).toBe("two");
      await test.backend.schedule(v2, undefined, { id: "once", delay: 25 });
      await test.backend.schedule(v2, undefined, {
        id: "interval",
        interval: 50,
      });
      await test.backend.ensureSchedule(v2, undefined, {
        id: "ensured",
        interval: 60,
      });
      await expect(
        test.backend.ensureSchedule(v1, undefined, {
          id: "ensured",
          interval: 60,
        }),
      ).rejects.toThrow("cannot rebind");
      await test.advanceTimeBy(100);
      const runs = await test.store.listExecutions({
        workflowKey: "checkout",
        limit: 100,
      });
      expect(runs.filter((row) => row.workflowVersion === 2)).toHaveLength(6);
      expect(
        (await test.backend.getSchedule("interval"))?.workflowVersion,
      ).toBe(2);
    } finally {
      await test.dispose();
    }
  });

  it("retains the version when continue-as-new omits an upgrade", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    const workflow = r
      .task("paged")
      .tags([tags.durableWorkflow.with({ version: 3 })])
      .dependencies({ durable })
      .run(async (page: number, { durable }) =>
        page === 0 ? durable.use().continueAsNew(1) : page,
      )
      .build();
    await test.run(
      r
        .resource("app")
        .register([resources.durable, workflow, test.durableRegistration])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(workflow, 0);
      expect(await test.backend.wait(id)).toBe(1);
      const next = (await test.store.getExecution(id))!.continuedAsExecutionId!;
      expect((await test.store.getExecution(next))?.workflowVersion).toBe(3);
    } finally {
      await test.dispose();
    }
  });

  it("parks a version this worker cannot execute and never substitutes another implementation", async () => {
    const store = new MemoryStore();
    const v2 = r
      .task("v2")
      .tags([tags.durableWorkflow.with({ key: "workflow", version: 2 })])
      .run(async () => "two")
      .build();
    const registry = new TaskRegistry(() => v2);
    registry.register(v2);
    expect(registry.find("workflow", 1)).toBeUndefined();
    expect(registry.find("workflow", 2)).toBe(v2);
    const service = new DurableService({
      store,
      tasks: [v2],
      taskExecutor: createTaskExecutor({ v1: async () => "one" }),
      timers: { enabled: false },
    });
    try {
      await store.saveExecution(
        pendingExecution({
          id: "old",
          workflowKey: "workflow",
          workflowVersion: 1,
        }),
      );
      await service.processExecution("old");
      expect((await store.getExecution("old"))?.status).toBe("pending");
      const [retry] = await store.getExecutionTimers("old");
      expect(retry.type).toBe("retry");
      await service.handleTimer(retry);
      const [next] = await store.getExecutionTimers("old");
      expect(next.id).not.toBe(retry.id);
      const v1 = r
        .task("v1")
        .tags([tags.durableWorkflow.with({ key: "workflow", version: 1 })])
        .run(async () => "one")
        .build();
      service.registerTask(v1);
      await service.handleTimer(next);
      expect((await store.getExecution("old"))?.result).toBe("one");
    } finally {
      await service.stop();
    }
  });
  it("rejects duplicate storage versions even when local task names match", () => {
    const first = r
      .task("process")
      .tags([tags.durableWorkflow.with({ version: 1 })])
      .run(async () => 1)
      .build();
    const second = r
      .task("process")
      .tags([tags.durableWorkflow.with({ version: 1 })])
      .run(async () => 2)
      .build();
    const registry = new TaskRegistry(
      undefined,
      () => "shared",
      (task) => (task === first ? "a.tasks.process" : "b.tasks.process"),
    );
    registry.register(first);
    expect(() => registry.register(second)).toThrow("a.tasks.process");
    expect(registry.find("shared", 1)).toBe(first);
  });
});
