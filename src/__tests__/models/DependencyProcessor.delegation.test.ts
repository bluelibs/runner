import { DependencyProcessor } from "../../models/DependencyProcessor";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor Delegation", () => {
  it("delegates extraction helpers to DependencyExtractor", async () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);

    const processor = new DependencyProcessor(
      fixture.store,
      fixture.eventManager,
      taskRunner,
      fixture.logger,
    );

    const extractor = (
      processor as unknown as { dependencyExtractor: Record<string, any> }
    ).dependencyExtractor;

    const extractedValue = { ok: true };
    extractor.extractDependency = jest.fn().mockResolvedValue(extractedValue);
    await expect(
      processor.extractDependency({ id: "dep" }, "test.source"),
    ).resolves.toBe(extractedValue);

    const emitFn = jest.fn();
    extractor.extractEventDependency = jest.fn().mockReturnValue(emitFn);
    expect(
      processor.extractEventDependency({ id: "event.id" } as any, "source"),
    ).toBe(emitFn);

    const taskFn = jest.fn();
    extractor.extractTaskDependency = jest.fn().mockResolvedValue(taskFn);
    await expect(
      processor.extractTaskDependency({ id: "task.id" } as any),
    ).resolves.toBe(taskFn);
  });
});
