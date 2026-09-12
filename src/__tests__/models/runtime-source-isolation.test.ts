import { r, run } from "../..";
import { genericError } from "../../errors";
import { createTestFixture } from "../test-utils";

describe("runtime source isolation", () => {
  it("forwards the signal and journal through fluent task builders", async () => {
    const controller = new AbortController();
    const task = r
      .task("readContext")
      .run(async (_, _deps, context) => context)
      .build();
    const runtime = await run(r.resource("app").register([task]).build());
    try {
      const context = await runtime.runTask(task, undefined, {
        signal: controller.signal,
      });
      expect(context?.signal).toBe(controller.signal);
      expect(context?.journal).toBeDefined();
      expect(context?.source.id).toBe("runtime.api");
    } finally {
      await runtime.dispose();
    }
  });
  it("keeps API sources intact across tasks, events, and concurrent runtimes", async () => {
    const event = r.event("notice").build();
    const sources: string[] = [];
    const hook = r
      .hook("observe")
      .on(event)
      .run(async (emission) => {
        expect(Reflect.set(emission.source, "id", "corrupted")).toBe(false);
        sources.push(emission.source.id);
      })
      .build();
    const task = r
      .task("inspectSource")
      .run(async (_, _deps, context) => {
        if (!context)
          throw genericError.new({ message: "Missing task context" });
        expect(Reflect.set(context.source, "id", "corrupted")).toBe(false);
        expect(Reflect.set(context.source, "kind", "task")).toBe(false);
        return context.source.id;
      })
      .build();
    const app = r.resource("app").register([task, event, hook]).build();
    const first = await run(app);
    const second = await run(app);
    try {
      expect(
        await Promise.all([first.runTask(task), second.runTask(task)]),
      ).toEqual(["runtime.api", "runtime.api"]);
      await first.emitEvent(event);
      await second.emitEvent(event);
      expect(sources).toEqual(["runtime.api", "runtime.api"]);
      expect(await first.runTask(task)).toBe("runtime.api");
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });

  it("protects direct runner and composer default sources", async () => {
    const fixture = createTestFixture();
    const task = r
      .task("inspectSource")
      .run(async (_, _deps, context) => {
        if (!context)
          throw genericError.new({ message: "Missing task context" });
        expect(Reflect.set(context.source, "id", "corrupted")).toBe(false);
        return context.source.id;
      })
      .build();
    fixture.store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    fixture.store.lock();
    const taskRunner = fixture.createTaskRunner();
    const composed = fixture.store
      .getMiddlewareManager()
      .composeTaskRunner(task);
    expect(await taskRunner.run(task)).toBe("runtime-internal-taskRunner");
    expect(await taskRunner.run(task)).toBe("runtime-internal-taskRunner");
    expect(await composed(undefined)).toBe("runtime-internal-taskRunner");
    expect(await composed(undefined)).toBe("runtime-internal-taskRunner");
  });
});
