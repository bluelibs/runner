import { defineResource } from "../../define";
import { run } from "../../run";
import { createTestFixture } from "../test-utils";

describe("RunResult coverage", () => {
  it("falls back to object ids when store id resolution misses", () => {
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
    expect(
      (
        runtime as unknown as {
          resolveRuntimeElementId: (reference: { id: string }) => string;
        }
      ).resolveRuntimeElementId(resource),
    ).toBe(store.findIdByDefinition(resource));
    expect(
      (
        runtime as unknown as {
          resolveRuntimeElementId: (reference: string) => string;
        }
      ).resolveRuntimeElementId("run-result-coverage-raw-id"),
    ).toBe("run-result-coverage-raw-id");
    expect(
      (
        runtime as unknown as {
          resolveRuntimeElementId: (reference: unknown) => string;
        }
      ).resolveRuntimeElementId({ missing: true }),
    ).toBe("[object Object]");
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
});
