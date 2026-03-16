import { defineEvent, defineResource } from "../../define";
import { RunResult } from "../../models/RunResult";
import { toCanonicalDefinitionFromStore } from "../../models/StoreLookup";
import { TaskRunner } from "../../models/TaskRunner";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("core fallback coverage", () => {
  it("Store falls back when owner, runtime source, root, and canonical definition lookups miss", async () => {
    const fixture = createTestFixture();
    const { store, eventManager } = fixture;
    const registry = (store as unknown as { registry: any }).registry;
    const ownerSpy = jest.spyOn(
      registry.visibilityTracker,
      "getOwnerResourceId",
    );
    const unresolvedReference = { missing: true };

    expect(
      store.getOwnerResourceId(unresolvedReference as any),
    ).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith(unresolvedReference);

    const event = defineEvent<{ value: number }>({
      id: "store-core-fallback-event",
    });
    store.storeGenericItem(event);

    const emitSpy = jest
      .spyOn(eventManager, "emit")
      .mockResolvedValue(undefined as never);
    const facade = (
      store as unknown as {
        createEventManagerFacade: () => {
          emit(
            eventDefinition: unknown,
            data: { value: number },
            options: {
              source: ReturnType<typeof runtimeSource.runtime>;
            },
          ): Promise<void>;
        };
      }
    ).createEventManagerFacade();

    await facade.emit(
      event,
      { value: 1 },
      {
        source: runtimeSource.runtime("store-core-fallback-source"),
      },
    );

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      { value: 1 },
      {
        source: runtimeSource.runtime("store-core-fallback-source"),
      },
    );

    const root = defineResource({
      id: "store-core-fallback-root",
    });
    const rootEntry = { resource: root };
    jest.spyOn(registry, "resolveDefinitionId").mockReturnValue(undefined);
    store.resources.set(root.id, rootEntry as never);

    expect(
      (
        store as unknown as {
          resolveRootEntry: (rootDefinition: unknown) => unknown;
        }
      ).resolveRootEntry(root),
    ).toBe(rootEntry);

    const unresolvedDefinition = { id: "", path: "keep-original-path" };
    expect(toCanonicalDefinitionFromStore(store, unresolvedDefinition)).toBe(
      unresolvedDefinition,
    );
  });

  it("TaskRunner and RunResult stringify unresolved references when store helpers miss", () => {
    const taskRunner = Object.create(TaskRunner.prototype) as {
      store: unknown;
      resolveResourceId(resource: unknown): string;
    };
    taskRunner.store = {};

    const runtime = Object.create(RunResult.prototype) as {
      store: unknown;
      resolveRuntimeElementId(reference: unknown): string;
    };
    runtime.store = {};

    expect(taskRunner.resolveResourceId({ missing: true })).toBe(
      "[object Object]",
    );
    expect(runtime.resolveRuntimeElementId({ missing: true })).toBe(
      "[object Object]",
    );
  });
});
