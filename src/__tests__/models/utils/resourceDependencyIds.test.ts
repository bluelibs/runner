import { defineResource, defineTask } from "../../../define";
import { getResourceDependencyIds } from "../../../models/utils/resourceDependencyIds";

describe("getResourceDependencyIds", () => {
  it("returns empty array for non-object dependency containers", () => {
    expect(getResourceDependencyIds(undefined)).toEqual([]);
    expect(getResourceDependencyIds(null)).toEqual([]);
    expect(getResourceDependencyIds("invalid")).toEqual([]);
  });

  it("collects direct and optional resource dependencies", () => {
    const dbResource = defineResource({
      id: "deps-resources-db",
    });
    const cacheResource = defineResource({
      id: "deps-resources-cache",
    });
    const nonResourceTask = defineTask({
      id: "deps-tasks-non-resource",
      run: async () => undefined,
    });

    const result = getResourceDependencyIds({
      dbResource,
      optionalCache: cacheResource.optional(),
      optionalTask: nonResourceTask.optional(),
      plainValue: 42,
    });

    expect(result).toEqual([dbResource.id, cacheResource.id]);
  });

  it("collects configured resources and arrays of resources", () => {
    const dbResource = defineResource({
      id: "deps-resources-configured-db",
      configSchema: { parse: (value: unknown) => value as { url: string } },
    });
    const queueResource = defineResource({
      id: "deps-resources-configured-queue",
      configSchema: { parse: (value: unknown) => value as { name: string } },
    });

    const result = getResourceDependencyIds({
      db: dbResource.with({ url: "postgres://..." }),
      array: [queueResource, dbResource.with({ url: "postgres://readonly" })],
    });

    expect(result).toEqual([dbResource.id, queueResource.id, dbResource.id]);
  });
});
