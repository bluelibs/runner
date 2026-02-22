import { StoreValidator } from "../../models/StoreValidator";
import { createTestFixture } from "../test-utils";

type RegistryLike = {
  tasks: Map<string, unknown>;
  resources: Map<string, unknown>;
  events: Map<string, unknown>;
  errors: Map<string, unknown>;
  asyncContexts: Map<string, unknown>;
  taskMiddlewares: Map<string, unknown>;
  resourceMiddlewares: Map<string, unknown>;
  tags: Map<string, unknown>;
  hooks: Map<string, unknown>;
};

function createRegistryStub(seedTaskId?: string): RegistryLike {
  const tasks = new Map<string, unknown>();
  if (seedTaskId) {
    tasks.set(seedTaskId, {});
  }

  return {
    tasks,
    resources: new Map<string, unknown>(),
    events: new Map<string, unknown>(),
    errors: new Map<string, unknown>(),
    asyncContexts: new Map<string, unknown>(),
    taskMiddlewares: new Map<string, unknown>(),
    resourceMiddlewares: new Map<string, unknown>(),
    tags: new Map<string, unknown>(),
    hooks: new Map<string, unknown>(),
  };
}

describe("StoreValidator regressions", () => {
  it("seeds pre-existing registry IDs into duplicate checks", () => {
    const seededRegistry = createRegistryStub("seeded.task");
    const validator = new StoreValidator(seededRegistry as never);

    expect(() => validator.checkIfIDExists("seeded.task")).toThrow(
      /already registered/i,
    );
  });

  it("throws Unknown duplicate type when id cache is stale", () => {
    const registry = createRegistryStub();
    const validator = new StoreValidator(registry as never) as unknown as {
      checkIfIDExists: (id: string) => void;
      registeredIds: Set<string>;
    };
    validator.registeredIds.add("ghost.id");

    expect(() => validator.checkIfIDExists("ghost.id")).toThrow(
      /already registered/i,
    );
  });

  it("rejects null in storeGenericItem guard", () => {
    const { store } = createTestFixture();

    expect(() => store.storeGenericItem(null as never)).toThrow(
      /unknown item type/i,
    );
  });

  it("rejects primitive values in storeGenericItem guard", () => {
    const { store } = createTestFixture();

    expect(() => store.storeGenericItem(42 as never)).toThrow(
      /unknown item type/i,
    );
  });
});
