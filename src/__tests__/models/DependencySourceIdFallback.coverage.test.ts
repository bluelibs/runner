describe("dependency source-id fallback coverage", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("covers DependencyExtractor fallback branches when store lookup resolution misses", () => {
    jest.isolateModules(() => {
      jest.doMock("../../models/store/StoreLookup", () => {
        const actual = jest.requireActual("../../models/store/StoreLookup");
        return {
          ...actual,
          resolveCanonicalIdFromStore: () => null,
          extractRequestedId: () => null,
        };
      });

      const { defineResource } = require("../../define");
      const {
        DependencyExtractor,
      } = require("../../models/dependency-processor/DependencyExtractor");

      const resource = defineResource({
        id: "extractor-source-fallback-resource",
        configSchema: {
          parse: (value: unknown) => value as { enabled: boolean },
        },
      });

      const extractor = new DependencyExtractor(
        {},
        {},
        {},
        {
          trace: () => undefined,
          error: () => undefined,
        },
        async () => undefined,
      ) as {
        resolveDefinitionId: (value: unknown) => string;
      };

      const objectWithId = { id: "extractor-source-fallback-object-id" };
      const functionWithId = Object.assign(() => undefined, {
        id: "extractor-source-fallback-function-id",
      });
      const functionWithoutId = () => undefined;

      expect(
        extractor.resolveDefinitionId("extractor-source-fallback-string-id"),
      ).toBe("extractor-source-fallback-string-id");
      expect(
        extractor.resolveDefinitionId(resource.with({ enabled: true })),
      ).toBe(resource.id);
      expect(extractor.resolveDefinitionId(objectWithId)).toBe(objectWithId.id);
      expect(extractor.resolveDefinitionId(functionWithId)).toBe(
        functionWithId.id,
      );
      expect(extractor.resolveDefinitionId({ id: "" })).toBe("[object Object]");
      expect(extractor.resolveDefinitionId(functionWithoutId)).toBe(
        String(functionWithoutId),
      );
    });
  });

  it("covers ResourceScheduler fallback branches when store lookup resolution misses", () => {
    jest.isolateModules(() => {
      jest.doMock("../../models/store/StoreLookup", () => {
        const actual = jest.requireActual("../../models/store/StoreLookup");
        return {
          ...actual,
          resolveCanonicalIdFromStore: () => null,
          extractRequestedId: () => null,
        };
      });

      const { defineResource } = require("../../define");
      const {
        ResourceScheduler,
      } = require("../../models/dependency-processor/ResourceScheduler");

      const resource = defineResource({
        id: "scheduler-source-fallback-resource",
        configSchema: {
          parse: (value: unknown) => value as { enabled: boolean },
        },
      });

      const scheduler = new ResourceScheduler(
        {},
        async () => undefined,
      ) as unknown as {
        resolveDefinitionId: (value: unknown) => string;
      };

      const objectWithId = { id: "scheduler-source-fallback-object-id" };
      const functionWithId = Object.assign(() => undefined, {
        id: "scheduler-source-fallback-function-id",
      });
      const functionWithoutId = () => undefined;

      expect(
        scheduler.resolveDefinitionId("scheduler-source-fallback-string-id"),
      ).toBe("scheduler-source-fallback-string-id");
      expect(
        scheduler.resolveDefinitionId(resource.with({ enabled: true })),
      ).toBe(resource.id);
      expect(scheduler.resolveDefinitionId(objectWithId)).toBe(objectWithId.id);
      expect(scheduler.resolveDefinitionId(functionWithId)).toBe(
        functionWithId.id,
      );
      expect(scheduler.resolveDefinitionId({ id: "" })).toBe("[object Object]");
      expect(scheduler.resolveDefinitionId(functionWithoutId)).toBe(
        String(functionWithoutId),
      );
    });
  });
});
