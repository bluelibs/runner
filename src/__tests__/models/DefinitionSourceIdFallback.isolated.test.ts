describe("definition source id fallbacks (isolated)", () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock("../../models/store/StoreLookup");
  });

  it("covers ResourceScheduler source-id fallback helper branches", () => {
    jest.isolateModules(() => {
      jest.doMock("../../models/store/StoreLookup", () => ({
        resolveCanonicalIdFromStore: () => null,
        extractRequestedId: () => null,
      }));

      const {
        ResourceScheduler,
      } = require("../../models/dependency-processor/ResourceScheduler");
      const { isResourceWithConfig } = require("../../define");
      const { symbolResourceWithConfig } = require("../../defs");
      const scheduler = new ResourceScheduler(
        { resources: new Map() } as any,
        async () => undefined,
      ) as {
        resolveDefinitionId(value: unknown): string;
      };

      const resourceWithConfig = {
        [symbolResourceWithConfig]: true,
        id: "isolated-scheduler-resource",
        resource: { id: "isolated-scheduler-resource" },
      };
      const functionWithId = Object.assign(() => undefined, {
        id: "isolated-scheduler-function",
      });

      expect(isResourceWithConfig(resourceWithConfig)).toBe(true);

      expect(scheduler.resolveDefinitionId("isolated-scheduler-string")).toBe(
        "isolated-scheduler-string",
      );
      expect(scheduler.resolveDefinitionId(resourceWithConfig)).toBe(
        "isolated-scheduler-resource",
      );
      expect(scheduler.resolveDefinitionId(functionWithId)).toBe(
        "isolated-scheduler-function",
      );
    });
  });

  it("covers DependencyExtractor source-id fallback helper branches", () => {
    jest.isolateModules(() => {
      jest.doMock("../../models/store/StoreLookup", () => ({
        resolveCanonicalIdFromStore: () => null,
        extractRequestedId: () => null,
      }));

      const {
        DependencyExtractor,
      } = require("../../models/dependency-processor/DependencyExtractor");
      const { isResourceWithConfig } = require("../../define");
      const { symbolResourceWithConfig } = require("../../defs");
      const extractor = new DependencyExtractor(
        {},
        {},
        {},
        { trace: () => undefined, error: () => undefined },
        async () => undefined,
      ) as {
        resolveDefinitionId(value: unknown): string;
      };

      const resourceWithConfig = {
        [symbolResourceWithConfig]: true,
        id: "isolated-extractor-resource",
        resource: { id: "isolated-extractor-resource" },
      };
      const functionWithId = Object.assign(() => undefined, {
        id: "isolated-extractor-function",
      });

      expect(isResourceWithConfig(resourceWithConfig)).toBe(true);

      expect(extractor.resolveDefinitionId("isolated-extractor-string")).toBe(
        "isolated-extractor-string",
      );
      expect(extractor.resolveDefinitionId(resourceWithConfig)).toBe(
        "isolated-extractor-resource",
      );
      expect(extractor.resolveDefinitionId(functionWithId)).toBe(
        "isolated-extractor-function",
      );
    });
  });
});
