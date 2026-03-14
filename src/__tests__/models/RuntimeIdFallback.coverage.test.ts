import { HealthReporter } from "../../models/HealthReporter";
import { createTestFixture } from "../test-utils";

describe("runtime id fallback coverage", () => {
  it("falls back to String(reference) in HealthReporter id resolution", () => {
    const reporter = new HealthReporter(
      {
        resolveDefinitionId: () => undefined,
      } as any,
      {
        ensureAvailable: () => undefined,
      },
    );

    expect((reporter as any).resolveDefinitionId({ bad: true })).toBe(
      "[object Object]",
    );
  });

  it("falls back to String(resource) in TaskRunner resource-id resolution", () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();

    expect((taskRunner as any).resolveResourceId({ bad: true })).toBe(
      "[object Object]",
    );
  });

  it("falls back to String(reference) in RunResult runtime-element resolution", () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);

    expect((runtime as any).resolveRuntimeElementId({ bad: true })).toBe(
      "[object Object]",
    );
  });
});
