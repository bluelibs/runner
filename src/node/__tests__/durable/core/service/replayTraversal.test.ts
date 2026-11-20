import { r } from "../../../..";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { DurableOperator } from "../../../../durable/core/DurableOperator";
import { replayWorkflow } from "../../../../durable/core/replay";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import {
  pendingExecution,
  createTaskExecutor,
} from "../../helpers/DurableService.unit.helpers";

describe("indexed replay traversal", () => {
  it("skips interleaved descendants when cached parallel parents finish in a different order", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      pendingExecution({ id: "run", status: "running", historyRecorded: true }),
    );
    const context = new DurableContext(store, new NoopEventBus(), "run", 1, {
      historyRecorded: true,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all([
      context.step("a", async () =>
        context.step("a-middle", async () => {
          await gate;
          return context.step("a-leaf", async () => 7);
        }),
      ),
      context.step("b", async () => {
        const result = await context.step("b-middle", async () =>
          context.step("b-leaf", async () => 8),
        );
        release();
        return result;
      }),
    ]);
    await context.step("tail", async () => 9);
    const fixture = await new DurableOperator(store).exportReplay("run");
    const effect = jest.fn(async () => 99);
    const workflow = r
      .task("replay")
      .run(async () => 1)
      .build();
    let current!: IDurableContext;
    const report = await replayWorkflow(workflow, fixture, {
      taskExecutor: createTaskExecutor({
        [workflow.id]: async () => {
          expect(
            await Promise.all([
              current.step("a", effect),
              current.step("b", effect),
            ]),
          ).toEqual([7, 8]);
          return current.step("tail", effect);
        },
      }),
      contextProvider: (ctx, run) => {
        current = ctx;
        return run();
      },
    });
    expect(report).toEqual({ compatible: true, matched: 3, issues: [] });
    expect(effect).not.toHaveBeenCalled();
  });
});
