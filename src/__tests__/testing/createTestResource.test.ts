import { task, r, resource, override, run, createTestResource } from "../..";

describe("createTestResource", () => {
  it("classic task/resource support throws contracts without DI", () => {
    const err = r.error("spec.errors.classic.throws").build();

    const t = task({
      id: "spec.tasks.classic.throws",
      throws: [err, "spec.errors.classic.throws.other", err],
      run: async () => "ok",
    });
    expect(t.throws).toEqual([err.id, "spec.errors.classic.throws.other"]);

    const res = resource({
      id: "spec.resources.classic.throws",
      throws: [err.id],
      init: async () => "ok",
    });
    expect(res.throws).toEqual([err.id]);
  });

  it("classic task/resource throws fail-fast on invalid throws entries", () => {
    expect(() =>
      task({
        id: "spec.tasks.classic.throws.invalid",
        // @ts-expect-error
        throws: [{}],
        run: async () => "ok",
      }),
    ).toThrow(/Invalid throws entry/);

    expect(() =>
      resource({
        id: "spec.resources.classic.throws.invalid",
        // @ts-expect-error
        throws: [{}],
        init: async () => "ok",
      }),
    ).toThrow(/Invalid throws entry/);
  });

  it("runs tasks within the full ecosystem and returns results", async () => {
    const double = task({ id: "t.double", run: async (x: number) => x * 2 });

    const app = resource({
      id: "app.root",
      register: [double],
    });

    const harness = createTestResource(app);
    const { value: t, dispose } = await run(harness);

    const result = await t.runTask(double, 21);
    expect(result).toBe(42);

    await dispose();
  });

  it("supports overrides for integration tests", async () => {
    const db = resource({ id: "db", init: async () => ({ kind: "real" }) });
    const getDbKind = task({
      id: "t.db.kind",
      dependencies: { db },
      run: async (_, { db }) => db.kind,
    });
    const app = resource({ id: "app", register: [db, getDbKind] });

    const mockDb = override(db, { init: async () => ({ kind: "mock" }) });

    const harness = createTestResource(app, { overrides: [mockDb] });
    const { value: t, dispose } = await run(harness);

    const kind = await t.runTask(getDbKind);
    expect(kind).toBe("mock");

    await dispose();
  });

  it("supports multiple harness instances without id collisions", async () => {
    const add1 = task({ id: "t.add1", run: async (n: number) => n + 1 });
    const app = resource({ id: "app.multi", register: [add1] });

    const h1 = createTestResource(app);
    const h2 = createTestResource(app);

    const [r1, r2] = await Promise.all([run(h1), run(h2)]);

    const v1 = await r1.value.runTask(add1, 1);
    const v2 = await r2.value.runTask(add1, 2);
    expect(v1).toBe(2);
    expect(v2).toBe(3);

    await Promise.all([r1.dispose(), r2.dispose()]);
  });

  it("runTask is typesafe in tests", async () => {
    const sum = task<{ a: number; b: number }, Promise<number>>({
      id: "t.sum",
      run: async (i) => i.a + i.b,
    });

    const upper = task<{ v: string }, Promise<string>>({
      id: "t.upper",
      run: async (i) => i.v.toUpperCase(),
    });

    const usesUpper = task<
      { n: number },
      Promise<number>,
      { upper: typeof upper }
    >({
      id: "t.usesUpper",
      dependencies: { upper },
      run: async (i, d) => Number(await d.upper({ v: String(i.n) })),
    });

    const app = resource({
      id: "app.types",
      register: [sum, upper, usesUpper],
    });
    const { value: t, dispose } = await run(createTestResource(app));

    const ok1: number | undefined = await t.runTask(sum, { a: 1, b: 2 });
    // Type-only checks (do not execute)
    const typeOnly = () => {
      // @ts-expect-error bad input
      t.runTask(sum, { a: 1 });
      // @ts-expect-error missing input
      t.runTask(sum);
    };
    void typeOnly;

    const ok2: number | undefined = await t.runTask(usesUpper, {
      n: 3,
    } as const);

    await dispose();
  });

  it("getResource returns the resource value when present", async () => {
    const db = resource({
      id: "db.value",
      init: async () => ({ url: "mem://" }),
    });
    const app = resource({ id: "app.for.getResource.success", register: [db] });
    const { value: t, dispose } = await run(createTestResource(app));

    const value = t.getResource("db.value");
    expect(value).toEqual({ url: "mem://" });

    await dispose();
  });
});
