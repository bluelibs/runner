import { r, run } from "../../index";
import { resolveForkedRegisterAndDependencies } from "../../definers/resourceFork";
import { createMessageError } from "../../errors";

describe("IResource.fork() (deep) coverage", () => {
  it("deep-forks nested resources registered by a deep-forked resource (register fn + configs)", async () => {
    const dep = r
      .resource("test.deep.nested.dep")
      .init(async () => ({ ok: true }))
      .build();

    const leaf = r
      .resource<{ name: string }>("test.deep.nested.leaf")
      .init(async (cfg) => ({ name: cfg.name }))
      .build();

    const parent = r
      .resource<{ label: string }>("test.deep.nested.parent")
      .dependencies((_cfg) => ({ dep }))
      .register((cfg) => [dep, leaf.with({ name: cfg.label })])
      .build();

    const base = r
      .resource("test.deep.nested.base")
      .register([parent.with({ label: "x" })])
      .build();

    const forked = base.fork("test.deep.nested.base.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    const app = r.resource("app").register([forked]).build();
    const runtime = await run(app);

    expect(() => runtime.getResourceValue(dep)).toThrow();
    expect(
      runtime.getResourceValue(dep.fork("forked.test.deep.nested.dep")),
    ).toEqual({ ok: true });
    expect(
      runtime.getResourceValue(leaf.fork("forked.test.deep.nested.leaf")),
    ).toEqual({ name: "x" });

    await runtime.dispose();
  });

  it("deep-fork remaps dependencies when dependencies is a function (static register)", () => {
    const child = r.resource("test.deep.depsfn.child").build();
    const base = r
      .resource("test.deep.depsfn.base")
      .dependencies(() => ({ child }))
      .register([child])
      .build();

    const forked = base.fork("test.deep.depsfn.base.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    if (typeof forked.dependencies !== "function") {
      throw createMessageError("Expected forked.dependencies to be a function");
    }
    expect(forked.dependencies(undefined).child.id).toBe(
      "forked.test.deep.depsfn.child",
    );
  });

  it("deep mode is a no-op when the base has no register field", () => {
    const base = r.resource("test.deep.noreg.base").build();
    const forked = base.fork("test.deep.noreg.base.forked", {
      register: "deep",
    });

    expect(Array.isArray(forked.register)).toBe(true);
    expect(forked.register).toHaveLength(0);
  });

  it("deep mode returns early when register is undefined", () => {
    const dep = r.resource("test.deep.undefined-register.dep").build();
    const dependencies = { dep };
    const result = resolveForkedRegisterAndDependencies({
      register: undefined as unknown as [],
      dependencies,
      forkId: "test.deep.undefined-register",
      options: { register: "deep" },
    });

    expect(result.register).toBeUndefined();
    expect(result.dependencies).toBe(dependencies);
  });
});
