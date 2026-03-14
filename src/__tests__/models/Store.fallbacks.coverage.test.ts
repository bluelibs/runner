import { defineEvent, defineResource } from "../../define";
import { toCanonicalDefinitionFromStore } from "../../models/StoreLookup";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("Store fallback coverage", () => {
  it("falls back to extracted ids and raw references in owner lookups", () => {
    const { store } = createTestFixture();
    const ownerSpy = jest
      .spyOn((store as any).registry.visibilityTracker, "getOwnerResourceId")
      .mockReturnValue(undefined);
    const lookup = (store as any).lookup;

    jest.spyOn(lookup, "resolveCandidateId").mockReturnValueOnce(null);
    jest
      .spyOn(lookup, "extractRequestedId")
      .mockReturnValueOnce("store-owner-extracted-id");
    store.getOwnerResourceId({ id: "store-owner-extracted-id" } as any);
    expect(ownerSpy).toHaveBeenLastCalledWith("store-owner-extracted-id");

    const unresolvedReference = { bad: true };
    jest.spyOn(lookup, "resolveCandidateId").mockReturnValueOnce(null);
    jest.spyOn(lookup, "extractRequestedId").mockReturnValueOnce(null);
    store.getOwnerResourceId(unresolvedReference as any);
    expect(ownerSpy).toHaveBeenLastCalledWith(unresolvedReference);
  });

  it("falls back to the root definition id when canonical lookup misses", () => {
    const { store } = createTestFixture();
    const root = defineResource({
      id: "store-fallback-root",
      init: async () => "root",
    });
    const rootEntry = {
      resource: root,
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    };
    store.resources.set(root.id, rootEntry as any);

    jest
      .spyOn((store as any).lookup, "resolveCandidateId")
      .mockReturnValueOnce(null);

    expect((store as any).resolveRootEntry(root)).toBe(rootEntry);
  });

  it("preserves unresolved definitions in canonical projection fallback", () => {
    const { store } = createTestFixture();
    const unresolvedDefinition = { id: "", path: "keep-me" };

    expect(
      toCanonicalDefinitionFromStore(store, unresolvedDefinition as any),
    ).toBe(unresolvedDefinition);
  });

  it("falls back to source ids when facade runtime-source canonicalization misses", async () => {
    const fixture = createTestFixture();
    const { store, eventManager } = fixture;
    const event = defineEvent({
      id: "store-fallback-facade-event",
    });
    const sourceId = { unknown: true };

    store.storeGenericItem(event);
    const facade = (store as any).createEventManagerFacade() as {
      emitLifecycle(
        eventDefinition: unknown,
        data: { value: number },
        source: ReturnType<typeof runtimeSource.runtime>,
      ): Promise<void>;
    };
    const emitLifecycleSpy = jest
      .spyOn(eventManager, "emitLifecycle")
      .mockResolvedValue(undefined as never);

    await facade.emitLifecycle(
      event,
      { value: 1 },
      {
        kind: "runtime",
        id: sourceId as any,
      },
    );

    expect(emitLifecycleSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      {
        kind: "runtime",
        id: sourceId,
      },
      undefined,
    );
  });
});
