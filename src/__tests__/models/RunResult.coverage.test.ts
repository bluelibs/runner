import { defineResource } from "../../define";
import { run } from "../../run";
import { createTestFixture } from "../test-utils";

describe("RunResult coverage", () => {
  it("resolves canonical ids and fails fast when runtime ids are missing", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);
    const resource = defineResource<{ enabled: boolean }>({
      id: "run-result-coverage-resource",
      init: async (config) => config.enabled,
    });

    store.resources.set(resource.id, {
      resource,
      config: { enabled: true },
      value: "ready",
      isInitialized: true,
      context: undefined,
    } as any);
    const entry = store.resources.get(resource.id)!;
    entry.value = "ready";
    entry.config = { enabled: true };
    entry.isInitialized = true;

    expect(runtime.getResourceValue(resource)).toBe("ready");
    expect(runtime.getResourceConfig(resource)).toEqual({ enabled: true });
    expect(store.findIdByDefinition(resource)).toBe(resource.id);
    expect(() =>
      runtime.getResourceValue("run-result-coverage-raw-id"),
    ).toThrow('Definition "run-result-coverage-raw-id" not found.');
    expect(() => runtime.getResourceValue({ missing: true } as any)).toThrow(
      /Expected non-empty string, got (undefined|null) at \$\./,
    );
  });

  it("resolves unique local resource ids to canonical runtime ids", async () => {
    const child = defineResource<{ enabled: boolean }>({
      id: "run-result-coverage-child",
      init: async (config) => config.enabled,
    });

    const group = defineResource({
      id: "run-result-coverage-group",
      register: [child.with({ enabled: true })],
      init: async () => "group",
    });

    const app = defineResource({
      id: "run-result-coverage-app",
      register: [group],
      init: async () => "app",
    });

    const runtime = await run(app);

    expect(runtime.store.findIdByDefinition(child)).not.toBe(child.id);
    expect(runtime.getResourceValue(child.id)).toBe(true);
    expect(runtime.getResourceConfig(child.id)).toEqual({ enabled: true });

    await runtime.dispose();
  });

  it("throws not-found errors when resolved ids are missing from store collections", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);

    const findIdSpy = jest.spyOn(store, "findIdByDefinition");
    findIdSpy
      .mockReturnValueOnce("run-result-missing-task")
      .mockReturnValueOnce("run-result-missing-event")
      .mockReturnValueOnce("run-result-missing-lazy-resource")
      .mockReturnValueOnce("run-result-missing-config-resource");

    runtime.setLazyOptions({
      lazyMode: true,
    });

    expect(() => runtime.runTask("missing-task")).toThrow(
      'Task "run-result-missing-task" not found.',
    );
    expect(() => runtime.emitEvent("missing-event")).toThrow(
      'Event "run-result-missing-event" not found.',
    );
    await expect(
      runtime.getLazyResourceValue("missing-lazy-resource"),
    ).rejects.toThrow('Resource "run-result-missing-lazy-resource" not found.');
    expect(() => runtime.getResourceConfig("missing-config-resource")).toThrow(
      'Resource "run-result-missing-config-resource" not found.',
    );
  });
});
