import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";

describe("run.exports-visibility privileged surfaces", () => {
  it("allows runtime.runTask() to execute a private task by definition and id", async () => {
    const privateTask = defineTask({
      id: "exports.privileged.runtime.private-task",
      run: async () => "secret",
    });

    const child = defineResource({
      id: "exports.privileged.runtime.child",
      register: [privateTask],
      exports: [],
    });

    const root = defineResource({
      id: "exports.privileged.runtime.root",
      register: [child],
    });

    const runtime = await run(root);
    expect(await runtime.runTask(privateTask)).toBe("secret");
    expect(
      await runtime.runTask("exports.privileged.runtime.private-task"),
    ).toBe("secret");
    await runtime.dispose();
  });

  it("keeps hook.on('*') globally observable, including private events", async () => {
    const seenEventIds: string[] = [];

    const privateEvent = defineEvent<{ value: string }>({
      id: "exports.privileged.wildcard.private-event",
    });

    const wildcardHook = defineHook({
      id: "exports.privileged.wildcard.hook",
      on: "*",
      run: async (event) => {
        seenEventIds.push(event.id);
      },
    });

    const child = defineResource({
      id: "exports.privileged.wildcard.child",
      register: [privateEvent],
      exports: [],
      dependencies: { privateEvent },
      async init(_, deps) {
        await deps.privateEvent({ value: "x" });
        return "child";
      },
    });

    const root = defineResource({
      id: "exports.privileged.wildcard.root",
      register: [child, wildcardHook],
      dependencies: { child },
      async init(_, deps) {
        return deps.child;
      },
    });

    const runtime = await run(root);
    expect(runtime.value).toBe("child");
    expect(seenEventIds).toContain(privateEvent.id);
    await runtime.dispose();
  });
});
