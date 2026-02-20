import { defineResource } from "../../define";
import { createTestFixture } from "../test-utils";

describe("OverrideManager override graph recursion", () => {
  it("handles cyclic override references without overflowing the call stack", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const first = defineResource({
      id: "override.cycle.first",
      overrides: [],
    });

    const second = defineResource({
      id: "override.cycle.second",
      overrides: [first],
    });

    first.overrides = [second];

    const root = defineResource({
      id: "override.cycle.root",
      register: [first, second],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).not.toThrow();
  });
});
