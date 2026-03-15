import { r } from "../../../";

// Type-only tests for fluent dependency chaining across builder surfaces.

{
  interface DepA {
    getA(): number;
  }

  interface DepB {
    getB(): string;
  }

  const depA = r
    .resource("depA")
    .init(async () => ({ getA: () => 42 }) as DepA)
    .build();
  const depB = r
    .resource("depB")
    .init(async () => ({ getB: () => "hello" }) as DepB)
    .build();

  r.task("test-task")
    .inputSchema<{ input: number }>({ parse: (v: any) => v })
    .resultSchema<number>({ parse: (v: any) => v })
    .dependencies({ a: depA })
    .dependencies({ b: depB })
    .run(async ({ input }, deps) => {
      const a = deps.a.getA();
      const b = deps.b.getB();
      // @ts-expect-error c not defined
      const c = (deps.c as any).getC();
      return input + a + b.length + Number(Boolean(c));
    })
    .build();

  r.task("test-task-override")
    .inputSchema<{ input: number }>({ parse: (v: any) => v })
    .resultSchema<number>({ parse: (v: any) => v })
    .dependencies({ a: depA })
    .dependencies({ b: depB }, { override: true })
    .run(async ({ input }, deps) => {
      const b = deps.b.getB();
      // @ts-expect-error Property 'a' does not exist after override
      const a = deps.a.getA();
      return input + b.length + Number(Boolean(a));
    })
    .build();
}

{
  interface DepA {
    getA(): number;
  }

  interface DepB {
    getB(): string;
  }

  const depA = r
    .resource("depA")
    .init(async () => ({ getA: () => 42 }) as DepA)
    .build();
  const depB = r
    .resource("depB")
    .init(async () => ({ getB: () => "hello" }) as DepB)
    .build();

  r.resource("test-resource")
    .resultSchema<string>({ parse: (v: any) => v })
    .dependencies({ a: depA })
    .dependencies({ b: depB })
    .init(async (_config, deps) => {
      const a = deps.a.getA();
      const b = deps.b.getB();
      // @ts-expect-error c not defined
      const c = (deps.c as any).getC();
      return String(a + b.length + Number(Boolean(c)));
    })
    .build();

  r.resource("test-resource-override")
    .resultSchema<string>({ parse: (v: any) => v })
    .dependencies({ a: depA })
    .dependencies({ b: depB }, { override: true })
    .init(async (_config, deps) => {
      const b = deps.b.getB();
      // @ts-expect-error Property 'a' does not exist after override
      const a = deps.a.getA();
      return String(b.length + Number(Boolean(a)));
    })
    .build();
}

{
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
    .init(async () => ({ handleA: () => {} }) as DepA)
    .build();
  const depB = r
    .resource("depB")
    .init(async () => ({ handleB: () => {} }) as DepB)
    .build();

  r.hook("test-hook")
    .on([eventA, eventB])
    .dependencies({ a: depA })
    .dependencies({ b: depB })
    .run(async (event, deps) => {
      if ("a" in event.data) (event.data as { a: number }).a;
      if ("b" in event.data) (event.data as { b: string }).b;
      // @ts-expect-error c not defined
      (deps.c as any).handleC();
    })
    .build();

  r.hook("test-hook-override")
    .on(eventA)
    .dependencies({ a: depA })
    .dependencies({ b: depB }, { override: true })
    .run(async (_event, deps) => {
      // @ts-expect-error Property 'a' does not exist after override
      deps.a.handleA();
    })
    .build();
}

{
  interface DepA {
    logA(): void;
  }

  interface DepB {
    logB(): void;
  }

  const depA = r
    .resource("depA")
    .init(async () => ({ logA: () => {} }) as DepA)
    .build();
  const depB = r
    .resource("depB")
    .init(async () => ({ logB: () => {} }) as DepB)
    .build();

  r.middleware
    .task("test-taskMw")
    .dependencies({ a: depA })
    .dependencies({ b: depB })
    .run(async ({ next, task }, deps) => {
      // @ts-expect-error c not defined
      (deps.c as any).logC();
      return next(task.input);
    })
    .build();

  r.middleware
    .resource("test-resourceMw")
    .dependencies({ a: depA })
    .dependencies({ b: depB })
    .run(async ({ next }, _deps) => {
      return next();
    })
    .build();

  r.middleware
    .task("test-taskMw-override")
    .dependencies({ a: depA })
    .dependencies({ b: depB }, { override: true })
    .run(async ({ next, task }, deps) => {
      // @ts-expect-error Property 'a' does not exist after override
      deps.a.logA();
      return next(task.input);
    })
    .build();
}
