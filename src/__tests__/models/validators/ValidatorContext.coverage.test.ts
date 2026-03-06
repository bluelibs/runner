import type { StoreRegistry } from "../../../models/StoreRegistry";
import { ValidatorContext } from "../../../models/validators/ValidatorContext";

type RegistryCollectionName =
  | "tasks"
  | "resources"
  | "events"
  | "errors"
  | "asyncContexts"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "tags"
  | "hooks";

function createValidatorRegistry(
  seededIds: Partial<Record<RegistryCollectionName, string[]>> = {},
): StoreRegistry {
  const createCollection = (ids: string[]) =>
    new Map(ids.map((id) => [id, { id }]));

  return {
    tasks: createCollection(seededIds.tasks ?? []),
    resources: createCollection(seededIds.resources ?? []),
    events: createCollection(seededIds.events ?? []),
    errors: createCollection(seededIds.errors ?? []),
    asyncContexts: createCollection(seededIds.asyncContexts ?? []),
    taskMiddlewares: createCollection(seededIds.taskMiddlewares ?? []),
    resourceMiddlewares: createCollection(seededIds.resourceMiddlewares ?? []),
    tags: createCollection(seededIds.tags ?? []),
    hooks: createCollection(seededIds.hooks ?? []),
  } as unknown as StoreRegistry;
}

describe("ValidatorContext coverage", () => {
  it("returns the seeded ids and stays in sync with tracked registrations", () => {
    const context = new ValidatorContext(
      createValidatorRegistry({
        tasks: ["validator.context.task"],
        tags: ["validator.context.tag"],
        hooks: ["validator.context.hook"],
      }),
    );

    const registeredIds = context.getRegisteredIds();

    expect([...registeredIds].sort()).toEqual([
      "validator.context.hook",
      "validator.context.tag",
      "validator.context.task",
    ]);

    context.trackRegisteredId("validator.context.manual");

    expect([...registeredIds].sort()).toEqual([
      "validator.context.hook",
      "validator.context.manual",
      "validator.context.tag",
      "validator.context.task",
    ]);
  });
});
