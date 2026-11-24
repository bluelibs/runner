import { defineEvent, defineHook } from "../../../define";
import { HookEventBuffer } from "../../../models/dependency-processor/HookEventBuffer";
import { ExecutionContextStore } from "../../../models/ExecutionContextStore";
import { runtimeSource } from "../../../types/runtimeSource";
import { HookDependencyState } from "../../../types/storeTypes";
import { createTestFixture } from "../../test-utils";

describe("HookEventBuffer", () => {
  it("runs buffered emissions before delivering the next live emission", async () => {
    const { eventManager, store } = createTestFixture();
    const buffer = new HookEventBuffer(
      eventManager,
      new ExecutionContextStore(null),
    );
    const event = defineEvent<string>({ id: "buffered" });
    const seen: string[] = [];
    const hook = defineHook({
      id: "buffer-hook",
      on: "*",
      run: async ({ data }) => {
        seen.push(data);
      },
    });
    const entry = {
      hook,
      computedDependencies: {},
      dependencyState: HookDependencyState.Pending,
    };
    store.hooks.set(hook.id, entry);
    buffer.attachListeners(store);

    const source = runtimeSource.runtime("test");
    await eventManager.emit(event, "buffered", source);
    expect(seen).toEqual([]);

    entry.dependencyState = HookDependencyState.Ready;
    await eventManager.emit(event, "live", source);
    expect(seen).toEqual(["buffered", "live"]);
  });
});
