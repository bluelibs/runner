import { r } from "../../../";

// Type-only tests for builder tag dependency accessors.
{
  const featureTag = r
    .tag<
      { group: string },
      { tenantId: string },
      { ok: boolean }
    >("types.builders.tags.feature")
    .build();

  const taggedTask = r
    .task("types.builders.tasks.feature")
    .tags([featureTag.with({ group: "alpha" })])
    .run(async (input) => ({ ok: input.tenantId.length > 0 }))
    .build();

  r.resource("types.builders.resources.feature.user")
    .register([featureTag, taggedTask])
    .dependencies({
      featureTag,
      featureTagBeforeInit: featureTag.startup(),
      maybeFeatureTag: featureTag,
      maybeFeatureTagBeforeInit: featureTag.startup().optional(),
    })
    .init(async (_config, deps) => {
      const task = deps.featureTag.tasks[0];
      if (task) {
        task.definition.run({ tenantId: "acme" }, {} as any);
        // @ts-expect-error contract-enforced input
        task.definition.run({ bad: true }, {} as any);
      }

      if (deps.maybeFeatureTag) {
        deps.maybeFeatureTag.tasks;
      }

      deps.featureTagBeforeInit.tasks;
      if (deps.maybeFeatureTagBeforeInit) {
        deps.maybeFeatureTagBeforeInit.resources;
      }

      const taggedTaskMatch = deps.featureTag.tasks[0];
      if (taggedTaskMatch?.run) {
        taggedTaskMatch.run({ tenantId: "acme" }, {} as any);
      }
      if (taggedTaskMatch?.intercept) {
        taggedTaskMatch.intercept(async (next, input) => next(input));
      }

      const taggedResourceMatch = deps.featureTag.resources[0];
      if (taggedResourceMatch) {
        const maybeValue: { ok: boolean } | undefined =
          taggedResourceMatch.value;
        void maybeValue;
      }
    })
    .build();
}
