import { r, resources, tags } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";

describe("ordinary tasks without results", () => {
  it("checkpoints void task steps and deduplicates successful void commands", async () => {
    const test = createDurableTestRuntime();
    const durable = test.durable;
    let steps = 0;
    let commands = 0;
    const write = r
      .task("write")
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        steps++;
        await durable.useStep().heartbeat({ written: true });
      })
      .build();
    const notify = r
      .task("notify")
      .run(async () => {
        commands++;
      })
      .build();
    const workflow = r
      .task("workflow")
      .tags([tags.durableWorkflow.with({ commands: [notify] })])
      .dependencies({ durable })
      .run(async (_: undefined, { durable }) => {
        const d = durable.use();
        await d.step("write", write);
        await d.sleep(1000);
        return "done";
      })
      .build();
    await test.run(
      r
        .resource("app")
        .register([
          resources.durable,
          write,
          notify,
          workflow,
          test.durableRegistration,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const id = await test.backend.start(workflow);
      expect(
        await test.backend.command(id, notify, undefined, {
          idempotencyKey: "notify",
        }),
      ).toBeUndefined();
      expect(
        await test.backend.command(id, notify, undefined, {
          idempotencyKey: "notify",
        }),
      ).toBeUndefined();
      await test.advanceTimeBy(1000);
      expect(await test.backend.wait(id)).toBe("done");
      expect(steps).toBe(1);
      expect(commands).toBe(1);
      expect(await test.store.getStepResult(id, "write")).toMatchObject({
        result: undefined,
      });
    } finally {
      await test.dispose();
    }
  });
});
