import { r, run, globals } from "../../index";
import { symbolTunneledBy } from "../../types/symbols";

describe("tunnelResourceMiddleware", () => {
  test("does not mutate original task definition when tunneling", async () => {
    const task = r
      .task("shared.task")
      .run(async () => "original")
      .build();

    const tunnel1 = r
      .resource("tunnel1")
      .tags([globals.tags.tunnel])
      .init(async () => ({
        mode: "client" as const,
        tasks: [task],
        run: async () => "tunneled 1",
      }))
      .build();

    const rt1 = await run(r.resource("app1").register([tunnel1, task]).build());

    const store = rt1.getResourceValue(globals.resources.store);
    const storeTask = store.tasks.get(task.id)!.task;

    // The store task SHOULD be mutated (local to this store)
    expect(storeTask.isTunneled).toBe(true);
    expect((storeTask as any)[symbolTunneledBy]).toBe("tunnel1");

    // The original task definition MUST NOT be mutated
    expect(task.isTunneled).toBeUndefined();
    expect((task as any)[symbolTunneledBy]).toBeUndefined();

    await rt1.dispose();
  });
});
