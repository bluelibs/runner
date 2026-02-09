import { defineResource, defineTask } from "../../../define";
import { run } from "../../../";

// Type-only tests for RunResult API typing.

// Scenario: RunResult.runTask should enforce input and dependency overrides.
void (async () => {
  type Input = { x: number };
  type Output = Promise<number>;

  const add = defineTask<Input, Output>({
    id: "types.add",
    run: async (input) => input.x + 1,
  });

  const depTask = defineTask<{ v: string }, Promise<string>>({
    id: "types.dep",
    run: async (input) => input.v.toUpperCase(),
  });

  const main = defineTask<Input, Output, { depTask: typeof depTask }>({
    id: "types.main",
    dependencies: { depTask },
    run: async (input, deps) => {
      const value = await deps.depTask({ v: String(input.x) });
      return Number(value) + 1;
    },
  });

  const app = defineResource({
    id: "types.app",
    register: [add, depTask, main],
  });
  const harness = defineResource({ id: "types.harness", register: [app] });

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

// Scenario: RunResult.getResourceConfig should preserve resource config typing.
void (async () => {
  type Config = { region: "us" | "eu"; retries: number };

  const client = defineResource<Config, Promise<{ ok: true }>>({
    id: "types.resource.config.client",
    init: async () => ({ ok: true }),
  });

  const app = defineResource({
    id: "types.resource.config.app",
    register: [client.with({ region: "us", retries: 3 })],
  });

  const rr = await run(app);
  const config = rr.getResourceConfig(client);
  const region: "us" | "eu" = config.region;
  const retries: number = config.retries;

  const configById = rr.getResourceConfig("types.resource.config.client");
  const idRetries: number = (configById as Config).retries;

  void region;
  void retries;
  void idRetries;
})();
