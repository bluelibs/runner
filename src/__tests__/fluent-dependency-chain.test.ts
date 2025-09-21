import { r } from "../index";

describe("fluent builders: dependency chaining", () => {
  it("tasks: multiple .dependencies() append types correctly", () => {
    interface DepA {
      getA(): number;
    }

    interface DepB {
      getB(): string;
    }

    const depA = r
      .resource("depA")
      .init(async () => ({ getA: () => 42 } as DepA))
      .build();
    const depB = r
      .resource("depB")
      .init(async () => ({ getB: () => "hello" } as DepB))
      .build();

    // Chaining appends types
    const task = r
      .task("test.task")
      .inputSchema<{ input: number }>({ parse: (v: any) => v })
      .resultSchema<number>({ parse: (v: any) => v })
      .dependencies({ a: depA })
      .dependencies({ b: depB }) // appends
      .run(async ({ input }, deps) => {
        const a = deps.a.getA(); // valid
        const b = deps.b.getB(); // valid
        // @ts-expect-error c not defined
        const c = (deps.c as any).getC();
        return input + a + b.length;
      })
      .build();

    // Override replaces (TS errors on accessing a, so no need for @ts-expect-error)
    const taskOverride = r
      .task("test.task.override")
      .inputSchema<{ input: number }>({ parse: (v: any) => v })
      .resultSchema<number>({ parse: (v: any) => v })
      .dependencies({ a: depA })
      .dependencies({ b: depB }, { override: true }) // only b: DepB
      .run(async ({ input }, deps) => {
        const b = deps.b.getB(); // valid
        // @ts-expect-error Property 'a' does not exist after override
        const a = deps.a.getA();
        return input + b.length;
      })
      .build();
  });

  it("resources: multiple .dependencies() append types correctly", () => {
    interface DepA {
      getA(): number;
    }

    interface DepB {
      getB(): string;
    }

    const depA = r
      .resource("depA")
      .init(async () => ({ getA: () => 42 } as DepA))
      .build();
    const depB = r
      .resource("depB")
      .init(async () => ({ getB: () => "hello" } as DepB))
      .build();

    // Chaining appends types
    const resource = r
      .resource("test.resource")
      .resultSchema<string>({ parse: (v: any) => v })
      .dependencies({ a: depA })
      .dependencies({ b: depB }) // appends
      .init(async (_config, deps) => {
        const a = deps.a.getA(); // valid
        const b = deps.b.getB(); // valid
        // @ts-expect-error c not defined
        const c = (deps.c as any).getC();
        return String(a + b.length);
      })
      .build();

    // Override replaces (TS errors on accessing a)
    const resourceOverride = r
      .resource("test.resource.override")
      .resultSchema<string>({ parse: (v: any) => v })
      .dependencies({ a: depA })
      .dependencies({ b: depB }, { override: true })
      .init(async (_config, deps) => {
        const b = deps.b.getB(); // valid
        // @ts-expect-error Property 'a' does not exist after override
        const a = deps.a.getA();
        return b.length.toString();
      })
      .build();
  });

  it("hooks: multiple .dependencies() append types correctly", () => {
    const eventA = r
      .event("eventA")
      .payloadSchema<{ a: number }>({ parse: (v: any) => v })
      .build();
    const eventB = r
      .event("eventB")
      .payloadSchema<{ b: string }>({ parse: (v: any) => v })
      .build();

    interface DepA {
      handleA(): void;
    }

    interface DepB {
      handleB(): void;
    }

    const depA = r
      .resource("depA")
      .init(async () => ({ handleA: () => {} } as DepA))
      .build();
    const depB = r
      .resource("depB")
      .init(async () => ({ handleB: () => {} } as DepB))
      .build();

    // Chaining appends
    const hook = r
      .hook("test.hook")
      .on([eventA, eventB])
      .dependencies({ a: depA })
      .dependencies({ b: depB })
      .run(async (event, deps) => {
        if ("a" in event.data) (event.data as { a: number }).a; // valid for eventA
        if ("b" in event.data) (event.data as { b: string }).b; // valid for eventB
        // @ts-expect-error c not defined
        (deps.c as any).handleC();
      })
      .build();

    // Override (TS errors on accessing a)
    const hookOverride = r
      .hook("test.hook.override")
      .on(eventA)
      .dependencies({ a: depA })
      .dependencies({ b: depB }, { override: true })
      .run(async (event, deps) => {
        // deps.b.handleB();  // valid
        // @ts-expect-error Property 'a' does not exist after override
        deps.a.handleA();
      })
      .build();
  });

  it("middleware: multiple .dependencies() append types correctly (task middleware example)", () => {
    interface DepA {
      logA(): void;
    }

    interface DepB {
      logB(): void;
    }

    const depA = r
      .resource("depA")
      .init(async () => ({ logA: () => {} } as DepA))
      .build();
    const depB = r
      .resource("depB")
      .init(async () => ({ logB: () => {} } as DepB))
      .build();

    // Task middleware chaining
    const taskMw = r.middleware
      .task("test.taskMw")
      .dependencies({ a: depA })
      .dependencies({ b: depB }) // appends
      .run(async ({ next, task }, deps) => {
        // deps.a.logA();  // valid
        // deps.b.logB();  // valid
        // @ts-expect-error c not defined
        (deps.c as any).logC();
        return next(task.input);
      })
      .build();

    // Resource middleware chaining
    const resourceMw = r.middleware
      .resource("test.resourceMw")
      .dependencies({ a: depA })
      .dependencies({ b: depB })
      .run(async ({ next }, deps) => {
        // deps.a.logA();  // valid
        // deps.b.logB();  // valid
        return next();
      })
      .build();

    // Override (TS errors on accessing a)
    const taskMwOverride = r.middleware
      .task("test.taskMw.override")
      .dependencies({ a: depA })
      .dependencies({ b: depB }, { override: true })
      .run(async ({ next, task }, deps) => {
        // deps.b.logB();  // valid
        // @ts-expect-error Property 'a' does not exist after override
        deps.a.logA();
        return next(task.input);
      })
      .build();
  });
});
