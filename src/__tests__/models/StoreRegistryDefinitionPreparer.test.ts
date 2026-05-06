import { StoreRegistryDefinitionPreparer } from "../../models/store/store-registry/StoreRegistryDefinitionPreparer";
import { RunnerMode } from "../../types/runner";

describe("StoreRegistryDefinitionPreparer", () => {
  it("throws a typed override error when override target is missing and target type is explicit", () => {
    const preparer = new StoreRegistryDefinitionPreparer();
    const collection = new Map<string, { task: { id: string } }>();

    expect(() =>
      preparer.prepareFreshValue({
        item: { id: "tests-override-missing-task" },
        collection,
        key: "task",
        mode: "override",
        overrideTargetType: "Task",
      }),
    ).toThrow(/Override target Task "tests-override-missing-task"/);
  });

  it("defaults missing override target type to Resource when not provided", () => {
    const preparer = new StoreRegistryDefinitionPreparer();
    const collection = new Map<string, { resource: { id: string } }>();

    expect(() =>
      preparer.prepareFreshValue({
        item: { id: "tests-override-missing-resource" },
        collection,
        key: "resource",
        mode: "override",
      }),
    ).toThrow(/Override target Resource "tests-override-missing-resource"/);
  });

  it("materializes dynamic overrides using the stored item config when no explicit config is provided", () => {
    const preparer = new StoreRegistryDefinitionPreparer();
    const item = {
      id: "tests-preparer-dynamic-overrides",
      config: { enabled: true },
      overrides: (config: { enabled: boolean }, mode: RunnerMode) => [
        `${mode}:${String(config.enabled)}`,
      ],
    };

    const prepared = preparer.prepareFreshValue({
      item,
      collection: new Map<string, { resource: typeof item }>(),
      key: "resource",
      mode: "normal",
      runtimeMode: RunnerMode.TEST,
    });

    expect(prepared.overrides).toEqual(["test:true"]);
  });
});
