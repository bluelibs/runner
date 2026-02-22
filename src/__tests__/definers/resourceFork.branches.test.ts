import { defineResource, defineTag } from "../../define";
import { run } from "../../run";

describe("resourceFork deep-fork branch coverage", () => {
  it("skips non-resource dependencies during deep-fork remap", async () => {
    const tag = defineTag({ id: "fork.remap.nonres.tag" });

    const inner = defineResource({
      id: "fork.remap.nonres.inner",
      dependencies: { tag },
      init: async () => "inner-value",
    });

    const base = defineResource({
      id: "fork.remap.nonres.base",
      register: [tag, inner],
      dependencies: { inner },
      init: async (_config, { inner }) => inner,
    });

    // Fork with "deep" — tag dependency is not a resource, so isResource() returns false
    const forked = base.fork("fork.remap.nonres.forked", {
      register: "deep",
    });

    const app = defineResource({
      id: "fork.remap.nonres.app",
      register: [tag, forked],
      dependencies: { forked },
      init: async (_config, { forked }) => forked,
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("inner-value");
    await runtime.dispose();
  });

  it("skips optional non-resource dependencies during remap", async () => {
    const tag = defineTag({ id: "fork.remap.opt.nonres.tag" });

    const inner = defineResource({
      id: "fork.remap.opt.nonres.inner",
      dependencies: { maybeTag: tag.optional() },
      init: async () => "inner-opt",
    });

    const base = defineResource({
      id: "fork.remap.opt.nonres.base",
      register: [tag, inner],
      dependencies: { inner },
      init: async (_config, { inner }) => inner,
    });

    const forked = base.fork("fork.remap.opt.nonres.forked", {
      register: "deep",
    });

    const app = defineResource({
      id: "fork.remap.opt.nonres.app",
      register: [tag, forked],
      dependencies: { forked },
      init: async (_config, { forked }) => forked,
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("inner-opt");
    await runtime.dispose();
  });

  it("keeps resource deps unchanged when no forked counterpart exists", async () => {
    const sharedResource = defineResource({
      id: "fork.remap.nofork.shared",
      init: async () => "shared-value",
    });

    const inner = defineResource({
      id: "fork.remap.nofork.inner",
      dependencies: { shared: sharedResource },
      init: async (_config, { shared }) => shared,
    });

    const base = defineResource({
      id: "fork.remap.nofork.base",
      // Only register inner — sharedResource is NOT part of the fork tree
      register: [inner],
      dependencies: { inner },
      init: async (_config, { inner }) => inner,
    });

    const forked = base.fork("fork.remap.nofork.forked", {
      register: "deep",
    });

    const app = defineResource({
      id: "fork.remap.nofork.app",
      register: [sharedResource, forked],
      dependencies: { forked },
      init: async (_config, { forked }) => forked,
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("shared-value");
    await runtime.dispose();
  });

  it("keeps optional resource deps unchanged when no forked counterpart exists", async () => {
    const sharedResource = defineResource({
      id: "fork.remap.opt.nofork.shared",
      init: async () => "shared-opt",
    });

    const inner = defineResource({
      id: "fork.remap.opt.nofork.inner",
      dependencies: { maybeShared: sharedResource.optional() },
      init: async (_config, { maybeShared }) => maybeShared ?? "fallback",
    });

    const base = defineResource({
      id: "fork.remap.opt.nofork.base",
      register: [inner],
      dependencies: { inner },
      init: async (_config, { inner }) => inner,
    });

    const forked = base.fork("fork.remap.opt.nofork.forked", {
      register: "deep",
    });

    const app = defineResource({
      id: "fork.remap.opt.nofork.app",
      register: [sharedResource, forked],
      dependencies: { forked },
      init: async (_config, { forked }) => forked,
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("shared-opt");
    await runtime.dispose();
  });
});
