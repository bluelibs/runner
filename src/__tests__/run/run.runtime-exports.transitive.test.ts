import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";

describe("run-runtime-exports transitive resource exports", () => {
  it("allows runtime.runTask() through an exported child resource surface", async () => {
    const deepTask = defineTask({
      id: "runtime-transitive-run-task",
      run: async () => "deep-result",
    });

    const child = defineResource({
      id: "runtime-transitive-run-child",
      register: [deepTask],
      isolate: { exports: [deepTask] },
    });

    const root = defineResource({
      id: "runtime-transitive-run-root",
      register: [child],
      isolate: { exports: [child] },
    });

    const runtime = await run(root, { shutdownHooks: false });
    await expect(runtime.runTask(deepTask)).resolves.toBe("deep-result");
    await runtime.dispose();
  });

  it("blocks runtime.runTask() when the exported child keeps the task private", async () => {
    const deepTask = defineTask({
      id: "runtime-transitive-run-private-task",
      run: async () => "private-result",
    });

    const child = defineResource({
      id: "runtime-transitive-run-private-child",
      register: [deepTask],
      isolate: { exports: "none" },
    });

    const root = defineResource({
      id: "runtime-transitive-run-private-root",
      register: [child],
      isolate: { exports: [child] },
    });

    const runtime = await run(root, { shutdownHooks: false });
    await expect(runtime.runTask(deepTask)).rejects.toMatchObject({
      id: "runtimeAccessViolation",
    });
    await runtime.dispose();
  });

  it("allows runtime.emitEvent() through an exported child resource surface", async () => {
    const seenPayloads: string[] = [];
    const deepEvent = defineEvent<{ value: string }>({
      id: "runtime-transitive-emit-event",
    });

    const deepHook = defineHook({
      id: "runtime-transitive-emit-hook",
      on: deepEvent,
      run: async (event) => {
        seenPayloads.push(event.data.value);
      },
    });

    const child = defineResource({
      id: "runtime-transitive-emit-child",
      register: [deepEvent, deepHook],
      isolate: { exports: [deepEvent] },
    });

    const root = defineResource({
      id: "runtime-transitive-emit-root",
      register: [child],
      isolate: { exports: [child] },
    });

    const runtime = await run(root, { shutdownHooks: false });
    await expect(runtime.emitEvent(deepEvent, { value: "ok" })).resolves.toBe(
      undefined,
    );
    expect(seenPayloads).toEqual(["ok"]);
    await runtime.dispose();
  });

  it("allows resource access helpers through an exported child resource surface", async () => {
    const deepResource = defineResource({
      id: "runtime-transitive-resource-value",
      async init() {
        return "resource-value";
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const child = defineResource({
      id: "runtime-transitive-resource-child",
      register: [deepResource],
      isolate: { exports: [deepResource] },
    });

    const root = defineResource({
      id: "runtime-transitive-resource-root",
      register: [child],
      isolate: { exports: [child] },
    });

    const runtime = await run(root, { shutdownHooks: false });
    expect(runtime.getResourceValue(deepResource)).toBe("resource-value");
    expect(runtime.getResourceConfig(deepResource)).toEqual({});

    const report = await runtime.getHealth();
    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.find(deepResource).id).toMatch(
      /runtime-transitive-resource-value$/,
    );

    await runtime.dispose();
  });

  it("allows runtime.getLazyResourceValue() through an exported child resource surface", async () => {
    const deepResource = defineResource({
      id: "runtime-transitive-lazy-resource",
      async init() {
        return "lazy-value";
      },
    });

    const child = defineResource({
      id: "runtime-transitive-lazy-child",
      register: [deepResource],
      isolate: { exports: [deepResource] },
    });

    const root = defineResource({
      id: "runtime-transitive-lazy-root",
      register: [child],
      isolate: { exports: [child] },
    });

    const runtime = await run(root, { lazy: true, shutdownHooks: false });
    await expect(runtime.getLazyResourceValue(deepResource)).resolves.toBe(
      "lazy-value",
    );
    await runtime.dispose();
  });

  it('reports explicit "exports: none" roots accurately in runtimeAccessViolation remediation', async () => {
    expect.assertions(2);

    const deepTask = defineTask({
      id: "runtime-transitive-none-task",
      run: async () => "private-result",
    });

    const root = defineResource({
      id: "runtime-transitive-none-root",
      register: [deepTask],
      isolate: { exports: "none" },
    });

    const runtime = await run(root, { shutdownHooks: false });

    try {
      await runtime.runTask(deepTask);
    } catch (error: any) {
      expect(error.id).toBe("runtimeAccessViolation");
      expect(String(error.remediation)).toContain("explicitly exports nothing");
    }

    await runtime.dispose();
  });
});
