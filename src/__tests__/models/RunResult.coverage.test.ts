import { defineResource } from "../../define";
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

    jest.spyOn(store, "resolveDefinitionId").mockReturnValue(undefined);

    expect(runtime.getResourceValue(resource)).toBe("ready");
    expect(runtime.getResourceConfig(resource)).toEqual({ enabled: true });
    expect(
      (
        runtime as unknown as {
          resolveRuntimeElementId: (reference: { id: string }) => string;
        }
      ).resolveRuntimeElementId(resource),
    ).toBe(resource.id);
    expect(
      (
        runtime as unknown as {
          resolveRuntimeElementId: (reference: string) => string;
        }
      ).resolveRuntimeElementId("run-result-coverage-raw-id"),
    ).toBe("run-result-coverage-raw-id");
  });
});
