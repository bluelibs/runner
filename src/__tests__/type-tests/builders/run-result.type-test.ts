import { r, run } from "../../../";

// Type-only tests for builder RunResult typing.

// Scenario: runTask should enforce input/output and dependency override signatures.
void (async () => {
  type Input = { x: number };

  const add = r
    .task("types.add")
    .inputSchema<Input>({ parse: (x: any) => x })
    .run(async (input: Input) => input.x + 1)
    .build();

  const depTask = r
    .task("types.dep")
    .inputSchema<{ v: string }>({ parse: (x: any) => x })
    .run(async (input) => input.v.toUpperCase())
    .build();

  const main = r
    .task("types.main")
    .dependencies({ depTask })
    .inputSchema<Input>({ parse: (x: any) => x })
    .run(async (input, deps) => {
      const value = await deps.depTask({ v: String(input.x) });
      return Number(value) + 1;
    })
    .build();

  const app = r.resource("types.app").register([add, depTask, main]).build();
  const harness = r.resource("types.harness").register([app]).build();

  const rr = await run(harness);
  const valid1: number | undefined = await rr.runTask(add, { x: 1 });
  void valid1;

  // @ts-expect-error wrong input type
  await rr.runTask(add, { z: 1 });
  // @ts-expect-error missing input
  await rr.runTask(add);

  const valid2: number | undefined = await rr.runTask(main, { x: 2 });
  void valid2;

  // @ts-expect-error wrong deps override type
  await rr.runTask(main, { x: 2 }, { depTask: async (input: number) => "x" });
})();
