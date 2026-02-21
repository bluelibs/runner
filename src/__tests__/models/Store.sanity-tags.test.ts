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

  it("fails when a definition depends on a tag it also carries", async () => {
    const rootInit = jest.fn(async () => "ok");
    const tag = defineTag({ id: "app.tags.self.dep" });

    const task = defineTask({
      id: "app.tasks.self.dep",
      tags: [tag],
      dependencies: { tag },
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app.root.self.dep",
      register: [tag, task],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot depend on tag "app\.tags\.self\.dep" because it already carries the same tag/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("fails when a definition depends on an optional wrapper of its own tag", async () => {
    const rootInit = jest.fn(async () => "ok");
    const tag = defineTag({ id: "app.tags.self.dep.optional" });

    const task = defineTask({
      id: "app.tasks.self.dep.optional",
      tags: [tag],
      dependencies: { maybeTag: tag.optional() },
      run: async () => undefined,
    });

    const app = defineResource({
      id: "app.root.self.dep.optional",
      register: [tag, task],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot depend on tag "app\.tags\.self\.dep\.optional" because it already carries the same tag/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });
});
