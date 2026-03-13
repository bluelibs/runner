import { defineResource } from "../../define";
import { validationError } from "../../errors";
import { createSyntheticFrameworkRoot } from "../../models/createSyntheticFrameworkRoot";
import { symbolRuntimeId } from "../../types/symbols";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("Store coverage", () => {
  it("derives runtime metadata from stamped ids and literal strings", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const stamped = {
      id: "ignored",
      [symbolRuntimeId]: "tasks.store-coverage-runtime",
    };

    jest
      .spyOn(registry, "getDisplayId")
      .mockImplementation((id: unknown) =>
        id === "tasks.store-coverage-runtime" ? "store-coverage-runtime" : id,
      );

    expect(store.getRuntimeDefinitionId(stamped)).toBe(
      "tasks.store-coverage-runtime",
    );
    expect(store.getRuntimeMetadata(stamped)).toEqual({
      id: "store-coverage-runtime",
      path: "tasks.store-coverage-runtime",
      runtimeId: "tasks.store-coverage-runtime",
    });
    expect(store.toPublicPath(stamped)).toBe("tasks.store-coverage-runtime");
    expect(store.createRuntimeSource("runtime", "runtime.literal")).toEqual(
      runtimeSource.runtime("runtime.literal", "runtime.literal"),
    );
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

  it("strips the internal framework root prefix from public ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const frameworkChild = {
      id: "ignored-framework-child",
      [symbolRuntimeId]: "runtime-framework-root.framework-child-x",
    };

    registry.registerDefinitionAlias(
      { id: "framework-child-x" },
      "runtime-framework-root.framework-child-x",
    );

    expect(store.getRuntimeMetadata(frameworkChild)).toEqual({
      id: "framework-child-x",
      path: "runtime-framework-root.framework-child-x",
      runtimeId: "runtime-framework-root.framework-child-x",
    });
  });

  it("keeps non-framework ids unchanged when stripping the internal framework prefix", () => {
    const { store } = createTestFixture();
    const registry = (
      store as unknown as {
        registry: { stripFrameworkRootPrefix: (id: string) => string };
      }
    ).registry;

    expect(registry.stripFrameworkRootPrefix("plain.resource")).toBe(
      "plain.resource",
    );
  });

  it("preserves the original root resource during framework composition", () => {
    const root = defineResource({
      id: "store-coverage-root-resource",
    });

    const frameworkRoot = createSyntheticFrameworkRoot({
      rootItem: root,
      debug: undefined,
    });

    const registerEntries = frameworkRoot.register as unknown as Array<{
      id: string;
      [key: symbol]: unknown;
    }>;
    expect(registerEntries[2]?.id).toBe(root.id);
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
