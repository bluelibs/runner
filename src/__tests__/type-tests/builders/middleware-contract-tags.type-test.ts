import {
  defineResourceMiddleware,
  defineTaskMiddleware,
  r,
  tags,
} from "../../../";

{
  const identityScopedMiddleware = r.middleware
    .task("types-middleware-contract-identity-scoped")
    .tags([tags.identityScoped])
    .dependencies((config) => {
      const identityScope = config.identityScope;
      void identityScope;
      // @ts-expect-error identityScope is the only injected config field
      config.missing;
      return {};
    })
    .run(async ({ next }, _deps, config) => {
      const identityScope = config.identityScope;

      if (identityScope) {
        identityScope.tenant;
        const user: boolean | undefined = identityScope.user;
        const required: boolean | undefined = identityScope.required;
        void user;
        void required;
        // @ts-expect-error unknown identityScope field
        identityScope.other;
      }

      // @ts-expect-error identityScope is the only injected config field
      config.missing;
      return next(undefined as never);
    })
    .build();

  identityScopedMiddleware.with({
    identityScope: { tenant: false },
  });

  identityScopedMiddleware.with({
    identityScope: { tenant: true, user: true },
  });

  identityScopedMiddleware.with({
    // @ts-expect-error identityScope requires tenant config when enabling user partitioning
    identityScope: { user: true },
  });
  identityScopedMiddleware.with({
    // @ts-expect-error identityScope cannot enable user partitioning when tenant partitioning is off
    identityScope: { tenant: false, user: true },
  });

  const configuredIdentityScopedMiddleware = identityScopedMiddleware.with({
    identityScope: { tenant: true },
  });

  configuredIdentityScopedMiddleware.config.identityScope?.tenant;
  // @ts-expect-error unknown config field
  configuredIdentityScopedMiddleware.config.other;

  const extractedIdentityScope = identityScopedMiddleware.extract(
    configuredIdentityScopedMiddleware,
  );

  extractedIdentityScope?.identityScope?.tenant;
  // @ts-expect-error extracted config keeps the contract-injected surface
  extractedIdentityScope?.missing;
}

{
  const featureTag = r
    .tag<
      { feature: string },
      void,
      void,
      "resourceMiddlewares"
    >("types-middleware-config-contract-tag")
    .build();

  const resourceMiddleware = r.middleware
    .resource("types-resource-middleware-config-contract")
    .tags([featureTag.with({ feature: "alpha" })])
    .run(async ({ next }, _deps, config) => {
      const feature: string = config.feature;
      void feature;
      // @ts-expect-error config contract should remain injected
      config.missing;
      return next(undefined as never);
    })
    .build();

  resourceMiddleware.with({ feature: "alpha" });
  // @ts-expect-error config contract should be enforced on .with()
  resourceMiddleware.with({ feature: 1 });

  const configuredResourceMiddleware = resourceMiddleware.with({
    feature: "beta",
  });

  configuredResourceMiddleware.config.feature satisfies string;
  // @ts-expect-error configured middleware config keeps the tag contract
  configuredResourceMiddleware.config.missing;

  const extractedResourceConfig = resourceMiddleware.extract(
    configuredResourceMiddleware,
  );

  if (extractedResourceConfig) {
    extractedResourceConfig.feature satisfies string;
    // @ts-expect-error extracted config keeps the tag contract
    extractedResourceConfig.missing;
  }
}

{
  const directIdentityScopedMiddleware = defineTaskMiddleware({
    id: "types-direct-task-middleware-contract",
    tags: [tags.identityScoped],
    dependencies: (config) => {
      config.identityScope?.tenant;
      // @ts-expect-error identityScope is the injected config contract
      config.missing;
      return {};
    },
    async run({ next }, _deps, config) {
      config.identityScope?.tenant;
      // @ts-expect-error identityScope is the injected config contract
      config.missing;
      return next(undefined as never);
    },
  });

  const configuredDirectIdentityScopedMiddleware =
    directIdentityScopedMiddleware.with({
      identityScope: { tenant: true, user: true },
    });

  configuredDirectIdentityScopedMiddleware.config.identityScope?.user;
  // @ts-expect-error configured direct middleware keeps the injected contract
  configuredDirectIdentityScopedMiddleware.config.missing;

  const extractedDirectIdentityScope = directIdentityScopedMiddleware.extract(
    configuredDirectIdentityScopedMiddleware,
  );

  extractedDirectIdentityScope?.identityScope?.tenant;
  // @ts-expect-error extracted config keeps the injected contract
  extractedDirectIdentityScope?.missing;
}

{
  const featureTag = r
    .tag<
      { feature: string },
      void,
      void,
      "resourceMiddlewares"
    >("types-direct-resource-middleware-config-contract-tag")
    .build();

  const directResourceMiddleware = defineResourceMiddleware({
    id: "types-direct-resource-middleware-contract",
    tags: [featureTag.with({ feature: "release" })],
    dependencies: (config) => {
      config.feature satisfies string;
      // @ts-expect-error tag config contract should flow into dependencies
      config.missing;
      return {};
    },
    async run({ next }, _deps, config) {
      config.feature satisfies string;
      // @ts-expect-error tag config contract should flow into run config
      config.missing;
      return next(undefined as never);
    },
  });

  const configuredDirectResourceMiddleware = directResourceMiddleware.with({
    feature: "stable",
  });

  configuredDirectResourceMiddleware.config.feature satisfies string;
  // @ts-expect-error configured direct resource middleware keeps the contract
  configuredDirectResourceMiddleware.config.missing;

  const extractedDirectResourceConfig = directResourceMiddleware.extract(
    configuredDirectResourceMiddleware,
  );

  if (extractedDirectResourceConfig) {
    extractedDirectResourceConfig.feature satisfies string;
    // @ts-expect-error extracted config keeps the contract
    extractedDirectResourceConfig.missing;
  }
}
