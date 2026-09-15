import { r } from "../../../..";
import { DurableService } from "../../../../durable/core/DurableService";
import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../../../durable/tags/durableWorkflow.tag";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("durable: workflow admission ownership", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(["completed", "sleeping", "failed", "retrying"])(
    "does not persist %s after losing only the admission lease",
    async (outcome) => {
      const store = new MemoryStore();
      const renewLock = store.renewLock.bind(store);
      jest
        .spyOn(store, "renewLock")
        .mockImplementation((resource, id, ttl) =>
          resource.startsWith("workflow-admission:")
            ? Promise.resolve(false)
            : renewLock(resource, id, ttl),
        );
      const task = r
        .task("limited")
        .tags([durableWorkflowTag.with({ concurrency: 1 })])
        .run(async () => "ok")
        .build();
      const service = new DurableService({
        store,
        tasks: [task],
        taskExecutor: createTaskExecutor({
          [task.id]: async () => {
            if (outcome === "sleeping") throw new SuspensionSignal("sleep");
            if (outcome !== "completed") throw new Error("attempt failed");
            return "ok";
          },
        }),
      });
      await store.saveExecution(
        pendingExecution({
          id: "execution",
          workflowKey: task.id,
          maxAttempts: outcome === "retrying" ? 2 : 1,
        }),
      );

      await service.processExecution("execution");

      expect((await store.getExecution("execution"))?.status).toBe("running");
      expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual(
        [],
      );
    },
  );
});
