import { defineEvent, defineResource } from "../../define";
import { validationError } from "../../errors";
import { createTestFixture } from "../test-utils";

describe("Store coverage", () => {
  it("keeps original events when definition resolution misses or no stored event exists", () => {
    const { store, eventManager } = createTestFixture();
    const resolver = (
      eventManager as unknown as {
        eventDefinitionResolver: (eventDefinition: unknown) => unknown;
      }
    ).eventDefinitionResolver;
    const event = defineEvent({
      id: "store-coverage-event",
    });
    const resolveSpy = jest.spyOn(store, "resolveDefinitionId");

    resolveSpy.mockReturnValueOnce(undefined);
    expect(resolver(event)).toBe(event);

    resolveSpy.mockReturnValueOnce("store-coverage-event-missing");
    expect(resolver(event)).toBe(event);
  });

  it("falls back to raw ids for owner lookup and fails fast on unresolved public ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const ownerSpy = jest.spyOn(
      registry.visibilityTracker,
      "getOwnerResourceId",
    );

    jest.spyOn(store, "resolveDefinitionId").mockReturnValue(undefined);

    expect(store.getOwnerResourceId("store-coverage-raw")).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith("store-coverage-raw");
    expect(() => store.toPublicId({ invalid: true } as any)).toThrow(
      /Unable to resolve a definition id/,
    );
  });

  it("fails fast when the computed root resource entry is missing after bootstrap", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const registry = (store as unknown as { registry: any }).registry;
    const taskRunner = fixture.createTaskRunner();
    const root = defineResource({
      id: "store-coverage-missing-root",
    });

    store.setTaskRunner(taskRunner);

    jest.spyOn(registry, "resolveDefinitionId").mockReturnValueOnce(undefined);
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === root.id) {
        return undefined;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    expect(() =>
      store.initializeStore(root, {}, fixture.createRuntimeResult(taskRunner)),
    ).toThrow(/Root resource was not registered during framework bootstrap/);
  });

  it("resolves aliased roots and preserves the defensive fallback after validation errors", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const resolveRootEntry = (
      store as unknown as {
        resolveRootEntry: (rootDefinition: unknown) => unknown;
      }
    ).resolveRootEntry.bind(store);
    const root = defineResource({
      id: "store-coverage-aliased-root",
    });
    const aliasedEntry = { id: "runner.root.alias" };

    jest
      .spyOn(registry, "resolveDefinitionId")
      .mockReturnValue("runner.root.alias");
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === "runner.root.alias") {
        return aliasedEntry;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    expect(resolveRootEntry(root)).toBe(aliasedEntry);

    jest.spyOn(registry, "resolveDefinitionId").mockReturnValue(undefined);
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === root.id) {
        return undefined;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    const validationThrowSpy = jest
      .spyOn(Object.getPrototypeOf(validationError), "throw")
      .mockImplementation(() => undefined as never);

    expect(resolveRootEntry(root)).toBeUndefined();
    expect(validationThrowSpy).toHaveBeenCalledWith({
      subject: "Root resource",
      id: root.id,
      originalError:
        "Root resource was not registered during framework bootstrap. This indicates an inconsistent runtime setup.",
    });
  });
});
