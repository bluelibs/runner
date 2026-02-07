import { defineResource } from "../../define";
import { run } from "../../run";
import { IResource } from "../../defs";

enum ResourceId {
  Root = "run.rootIsolation.root",
  ChoiceA = "run.rootIsolation.choiceA",
  ChoiceB = "run.rootIsolation.choiceB",
}

type RootConfig = { useA: boolean };
type SelectedResource = IResource<any, Promise<string>, any, any, any>;

describe("run root isolation regression", () => {
  it("keeps root dynamic dependencies/register isolated per run config", async () => {
    const choiceA = defineResource({
      id: ResourceId.ChoiceA,
      init: async () => "A",
    });

    const choiceB = defineResource({
      id: ResourceId.ChoiceB,
      init: async () => "B",
    });

    const root = defineResource<
      RootConfig,
      Promise<string>,
      {
        selected: SelectedResource;
      }
    >({
      id: ResourceId.Root,
      register: (config) => (config.useA ? [choiceA] : [choiceB]),
      dependencies: (config) => ({
        selected: config.useA ? choiceA : choiceB,
      }),
      init: async (_config, { selected }) => selected,
    });

    const first = await run(root.with({ useA: true }));
    const second = await run(root.with({ useA: false }));

    expect(first.value).toBe("A");
    expect(second.value).toBe("B");

    await first.dispose();
    await second.dispose();
  });
});
