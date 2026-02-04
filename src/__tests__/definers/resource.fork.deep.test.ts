import { symbolResourceForkedFrom } from "../../defs";
import { isOptional, isResource, isResourceWithConfig } from "../../define";
import { r, run } from "../../index";
import {
  assertRegisterArray,
  assertRegisterFn,
} from "./resource.fork.test.utils";

describe("IResource.fork() (deep)", () => {
  it("deep-forks registered resources with reId and remaps dependencies", async () => {
    const child = r
      .resource("test.deep.child")
      .init(async () => ({ ok: true }))
      .build();

    const sharedTask = r
      .task("test.deep.shared.task")
      .run(async () => "ok")
      .build();

    const base = r
      .resource("test.deep.base")
      .dependencies({ child })
      .register([child, sharedTask])
      .init(async (_, deps) => deps.child)
      .build();

    const reId = (id: string) => `forked.${id}`;
    const forked = base.fork("test.deep.base.forked", {
      register: "deep",
      reId,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;

    expect(forkedRegister.some((item) => item.id === reId(child.id))).toBe(
      true,
    );
    expect(forkedRegister.some((item) => item.id === reId(sharedTask.id))).toBe(
      false,
    );

    const deps =
      typeof forked.dependencies === "function"
        ? forked.dependencies(undefined)
        : forked.dependencies;
    if (!deps || !("child" in deps)) {
      throw new Error("Expected forked.dependencies to include child");
    }
    expect(deps.child.id).toBe(reId(child.id));
    expect(forked[symbolResourceForkedFrom]?.fromId).toBe(base.id);

    const app = r.resource("app").register([forked, sharedTask]).build();
    const runtime = await run(app);

    expect(() => runtime.getResourceValue(child)).toThrow();
    expect(runtime.getResourceValue(forked)).toEqual({ ok: true });

    await runtime.dispose();
  });

  it("deep-fork remaps sibling resource dependencies (registered together)", async () => {
    const a = r
      .resource("test.deep.sibling.a")
      .init(async () => ({ value: 1 }))
      .build();

    const b = r
      .resource("test.deep.sibling.b")
      .dependencies({ a })
      .init(async (_, deps) => ({ value: deps.a.value + 1 }))
      .build();

    const base = r
      .resource("test.deep.sibling.base")
      // reverse order on purpose: b depends on a
      .register([b, a])
      .build();

    const forked = base.fork("test.deep.sibling.base.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterArray(forked.register);
    const forkedB = forked.register.find(
      (item) => item.id === "forked.test.deep.sibling.b",
    );
    expect(forkedB).toBeDefined();
    if (!forkedB || !isResource(forkedB)) {
      throw new Error("Expected forkedB to be a resource");
    }

    const deps =
      typeof forkedB.dependencies === "function"
        ? forkedB.dependencies(undefined)
        : forkedB.dependencies;
    if (!deps || !("a" in deps)) {
      throw new Error("Expected forkedB.dependencies to include a");
    }
    expect(deps.a.id).toBe("forked.test.deep.sibling.a");

    const app = r.resource("app").register([forked]).build();
    const runtime = await run(app);

    expect(runtime.getResourceValue(forkedB)).toEqual({ value: 2 });

    await runtime.dispose();
  });

  it("deep-forks resources registered via .with(config)", () => {
    const child = r
      .resource<{ name: string }>("test.deep.child.cfg")
      .init(async (cfg) => ({ name: cfg.name }))
      .build();

    const base = r
      .resource("test.deep.base.cfg")
      .register([child.with({ name: "x" })])
      .build();

    const forked = base.fork("test.deep.base.cfg.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;

    expect(forkedRegister).toHaveLength(1);
    const item = forkedRegister[0];
    if (!isResourceWithConfig(item)) {
      throw new Error(
        "Expected forked register item to be a resource with config",
      );
    }
    expect(item.resource.id).toBe("forked.test.deep.child.cfg");
    expect(item.config).toEqual({ name: "x" });
  });

  it("deep-fork caches duplicate registerables", () => {
    const child = r.resource("test.deep.cache.child").build();
    const base = r
      .resource("test.deep.cache.base")
      .register([child, child])
      .build();

    const forked = base.fork("test.deep.cache.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    expect(forkedRegister[0]).toBe(forkedRegister[1]);
  });

  it("deep-fork validates reId return value", () => {
    const child = r.resource("test.deep.reid.child").build();
    const base = r.resource("test.deep.reid.base").register([child]).build();

    expect(() =>
      base.fork("test.deep.reid.forked", {
        register: "deep",
        reId: () => "",
      }),
    ).toThrow("fork(reId) must return a non-empty string");
  });

  it("deep-fork supports register functions", () => {
    const child = r.resource("test.deep.fn.child").build();
    const base = r
      .resource("test.deep.fn.base")
      .dependencies(() => ({ child }))
      .register(() => [child])
      .build();

    const forked = base.fork("test.deep.fn.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    assertRegisterFn(forked.register);
    const forkedRegister = forked.register(undefined);
    expect(forkedRegister[0].id).toBe("forked.test.deep.fn.child");

    if (typeof forked.dependencies !== "function") {
      throw new Error("Expected forked.dependencies to be a function");
    }
    expect(forked.dependencies(undefined).child.id).toBe(
      "forked.test.deep.fn.child",
    );
  });

  it("deep-fork remaps optional resource dependencies", async () => {
    const child = r
      .resource("test.deep.optional.child")
      .init(async () => ({ ok: true }))
      .build();

    const base = r
      .resource("test.deep.optional.base")
      .dependencies({ child: child.optional() })
      .register([child])
      .init(async (_, deps) => ({ hasChild: Boolean(deps.child?.ok) }))
      .build();

    const forked = base.fork("test.deep.optional.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    const deps =
      typeof forked.dependencies === "function"
        ? forked.dependencies(undefined)
        : forked.dependencies;
    if (!deps || !("child" in deps)) {
      throw new Error("Expected forked.dependencies to include child");
    }
    const dep = deps.child;
    if (!isOptional(dep)) {
      throw new Error("Expected forked.dependencies.child to be optional");
    }
    expect(dep.inner.id).toBe("forked.test.deep.optional.child");

    const app = r.resource("app").register([forked]).build();
    const runtime = await run(app);

    expect(runtime.getResourceValue(forked)).toEqual({ hasChild: true });

    await runtime.dispose();
  });

  it("deep-fork supports register functions with no dependencies", () => {
    const child = r.resource("test.deep.fn.nodeps.child").build();
    const base = r
      .resource("test.deep.fn.nodeps.base")
      .register(() => [child])
      .build();

    const forked = base.fork("test.deep.fn.nodeps.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    expect(forked.dependencies).toBeUndefined();
    assertRegisterFn(forked.register);
    expect(forked.register(undefined)[0].id).toBe(
      "forked.test.deep.fn.nodeps.child",
    );
  });

  it("deep-fork supports register functions with object dependencies", () => {
    const child = r.resource("test.deep.fn.objdeps.child").build();
    const base = r
      .resource("test.deep.fn.objdeps.base")
      .dependencies({ child })
      .register(() => [child])
      .build();

    const forked = base.fork("test.deep.fn.objdeps.forked", {
      register: "deep",
      reId: (id) => `forked.${id}`,
    });

    if (typeof forked.dependencies !== "function") {
      throw new Error("Expected forked.dependencies to be a function");
    }
    expect(forked.dependencies(undefined).child.id).toBe(
      "forked.test.deep.fn.objdeps.child",
    );
  });

  it("deep-fork uses the default reId prefix", () => {
    const child = r.resource("test.deep.default.child").build();
    const base = r.resource("test.deep.default.base").register([child]).build();

    const forked = base.fork("test.deep.default.forked", { register: "deep" });

    assertRegisterArray(forked.register);
    const forkedRegister = forked.register;
    expect(forkedRegister[0].id).toBe(
      "test.deep.default.forked.test.deep.default.child",
    );
  });
});
