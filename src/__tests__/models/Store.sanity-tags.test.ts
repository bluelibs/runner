import { defineResource, defineTag, defineTask } from "../../define";
import { run } from "../../run";
import { RunnerMode } from "../../types/runner";

describe("Store sanity checks (tags)", () => {
  it("fails before initialization when a definition has duplicate tag ids", async () => {
    const rootInit = jest.fn(async () => "ok");
    const tag = defineTag({ id: "app.tags.duplicate" });

    const task = defineTask({
      id: "app.tasks.duplicate-tag",
      tags: [tag, tag],
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app.root",
      register: [tag, task],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /duplicate tag "app\.tags\.duplicate"/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("allows definitions with unique tag ids", async () => {
    const rootInit = jest.fn(async () => "ok");
    const tagOne = defineTag({ id: "app.tags.unique.one" });
    const tagTwo = defineTag({ id: "app.tags.unique.two" });

    const task = defineTask({
      id: "app.tasks.unique-tags",
      tags: [tagOne, tagTwo],
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app.root.unique-tags",
      register: [tagOne, tagTwo, task],
      init: rootInit,
    });

    const runtime = await run(app, { mode: RunnerMode.TEST });
    expect(rootInit).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });
});
