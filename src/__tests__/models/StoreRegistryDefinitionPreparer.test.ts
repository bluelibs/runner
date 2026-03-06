import { StoreRegistryDefinitionPreparer } from "../../models/store-registry/StoreRegistryDefinitionPreparer";

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
});
