import { defineResource } from "../../define";
import {
  StoreLookup,
  extractRequestedId,
  resolveCanonicalIdFromStore,
  resolveRequestedIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../../models/store/StoreLookup";

describe("StoreLookup coverage", () => {
  it("extracts requested ids from strings, configured resources, functions, and rejects invalid ids", () => {
    const callableDefinition = Object.assign(() => undefined, {
      id: "callable-definition",
    });
    const resource = defineResource({
      id: "resource-from-config",
      init: async () => "ok",
    });

    expect(extractRequestedId("task-id")).toBe("task-id");
    expect(extractRequestedId(resource.with({ enabled: true } as never))).toBe(
      "resource-from-config",
    );
    expect(extractRequestedId(callableDefinition)).toBe("callable-definition");
    expect(extractRequestedId({ id: "" })).toBeNull();
  });

  it("returns null canonical ids when no candidate id can be resolved", () => {
    const lookup = new StoreLookup({});

    expect(lookup.tryCanonicalId({ id: "missing-definition" })).toBeNull();
  });

  it("falls back to store helpers and requested ids when lookup helpers miss", () => {
    const definition = { id: "task.local" };

    expect(
      resolveCanonicalIdFromStore(
        {
          lookup: {
            tryCanonicalId: () => null,
            resolveCandidateId: () => null,
            extractRequestedId: () => null,
          },
          hasDefinition: (reference) => reference === definition,
          findIdByDefinition: () => "app.tasks.task.local",
        },
        definition,
      ),
    ).toBe("app.tasks.task.local");

    expect(
      resolveRequestedIdFromStore(
        {
          lookup: {
            tryCanonicalId: () => null,
            resolveCandidateId: () => null,
            extractRequestedId: () => null,
          },
        },
        { id: "task.requested" },
      ),
    ).toBe("task.requested");
  });

  it("keeps the original definition when canonicalization cannot resolve an id", () => {
    const definition = { id: "", path: "keep-original-path" };

    expect(
      toCanonicalDefinitionFromStore(
        {
          lookup: {
            tryCanonicalId: () => null,
            resolveCandidateId: () => null,
            extractRequestedId: () => null,
          },
        },
        definition,
      ),
    ).toBe(definition);
  });
});
