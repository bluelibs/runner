import { identityContextRequiredError } from "../../../../errors";
import { defineResource, defineTask } from "../../../../define";
import {
  cacheMiddleware,
  cacheResource,
} from "../../../../globals/middleware/cache/middleware";
import { run } from "../../../../run";

describe("cache resource invalidateKeys options", () => {
  it("fails fast when the requested identityScope requires identity", async () => {
    const app = defineResource({
      id: "cache-key-invalidation-options-required-app",
      register: [cacheResource],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        let thrown: unknown;

        try {
          await cache.invalidateKeys("profile", {
            identityScope: { tenant: true },
          });
        } catch (error) {
          thrown = error;
        }

        expect(identityContextRequiredError.is(thrown)).toBe(true);
      },
    });

    await run(app);
  });

  it("falls back to the raw key when identityScope.required is false and no identity exists", async () => {
    let calls = 0;
    const task = defineTask({
      id: "cache-key-invalidation-options-optional-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          keyBuilder: () => "profile",
        }),
      ],
      run: async () => ++calls,
    });

    const app = defineResource({
      id: "cache-key-invalidation-options-optional-app",
      register: [cacheResource, task],
      dependencies: { cache: cacheResource, task },
      async init(_, { cache, task }) {
        await expect(task()).resolves.toBe(1);
        await expect(task()).resolves.toBe(1);

        await expect(
          cache.invalidateKeys("profile", {
            identityScope: { required: false, tenant: true },
          }),
        ).resolves.toBe(1);

        await expect(task()).resolves.toBe(2);
      },
    });

    await run(app);
  });

  it("rejects invalid identityScope options at runtime", async () => {
    const app = defineResource({
      id: "cache-key-invalidation-options-invalid-app",
      register: [cacheResource],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        await expect(
          cache.invalidateKeys("profile", {
            identityScope: "tenant" as never,
          }),
        ).rejects.toThrow(/identityscope/i);
      },
    });

    await run(app);
  });
});
