import { globals, r, run } from "../../..";
import { DurableExecutionError } from "../core/DurableService";
import { createDurableServiceResource } from "../core/resource";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: createDurableServiceResource", () => {
  it("awaits nested taskRunner promises (normal path)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable.resource.ok")
      .run(async () => "ok")
      .build();

    const durableService = createDurableServiceResource({
      store,
      tasks: [task],
    });

    const app = r.resource("app").register([durableService, task]).build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    const taskRunner = runtime.getResourceValue(globals.resources.taskRunner);
    const spy = jest
      .spyOn(taskRunner, "run")
      .mockResolvedValue(Promise.resolve("ok"));

    const service = runtime.getResourceValue(durableService);
    await expect(service.execute(task)).resolves.toBe("ok");

    spy.mockRestore();
    await runtime.dispose();
  });

  it("handles undefined taskRunner results (edge branch)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable.resource.undefined")
      .run(async () => "ok")
      .build();

    const durableService = createDurableServiceResource({
      store,
      tasks: [task],
    });

    const app = r.resource("app").register([durableService, task]).build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    const taskRunner = runtime.getResourceValue(globals.resources.taskRunner);
    const spy = jest.spyOn(taskRunner, "run").mockResolvedValue(undefined);

    const service = runtime.getResourceValue(durableService);
    await expect(service.execute(task)).rejects.toBeInstanceOf(
      DurableExecutionError,
    );

    spy.mockRestore();
    await runtime.dispose();
  });
});
