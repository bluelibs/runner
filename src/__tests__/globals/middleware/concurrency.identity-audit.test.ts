import { defineTask } from "../../../define";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { withSiblingTaskCollisionRuntime } from "./keyedMiddlewareCollision.shared";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Concurrency Middleware task-id audit", () => {
  it("does not derive implicit sharing from task ids when sibling tasks reuse one local id", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;

    await withSiblingTaskCollisionRuntime({
      appId: "app-concurrency-lineage-audit",
      createTask: () =>
        defineTask({
          id: "sync",
          middleware: [concurrencyTaskMiddleware.with({ limit: 1 })],
          run: async () => {
            activeTasks += 1;
            maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
            await sleep(20);
            activeTasks -= 1;
          },
        }),
      test: async ({ runtime, taskIds }) => {
        await Promise.all([
          runtime.runTask(taskIds.billing),
          runtime.runTask(taskIds.crm),
        ]);
      },
    });

    expect(maxActiveTasks).toBe(2);
  });
});
