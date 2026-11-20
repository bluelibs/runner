import { r, resources, run, tags } from "../../../..";
import { createDurableTestSetup } from "../../../../durable/test-utils";

describe("durable versioned child waits", () => {
  it("rejects a different version of the same workflow key", async () => {
    const test = createDurableTestSetup({
      durableConfig: { execution: { maxAttempts: 1 } },
    });
    const durable = test.durable;
    const v1 = r
      .task("child-one")
      .tags([tags.durableWorkflow.with({ key: "child", version: 1 })])
      .run(async () => ({ value: 42 }))
      .build();
    const v2 = r
      .task("child-two")
      .tags([tags.durableWorkflow.with({ key: "child", version: 2 })])
      .run(async () => "v2 output")
      .build();
    const unversioned = r
      .task("child-legacy")
      .tags([tags.durableWorkflow.with({ key: "child" })])
      .run(async () => ({ value: 7 }))
      .build();
    const parent = r
      .task("parent")
      .tags([tags.durableWorkflow])
      .dependencies({ durable })
      .run(async (id: string, { durable }) => {
        const result = await durable.use().waitForExecution(v1, id);
        return result.value;
      })
      .build();
    const legacyParent = r
      .task("parent-legacy")
      .tags([tags.durableWorkflow])
      .dependencies({ durable })
      .run(async (id: string, { durable }) => {
        const result = await durable.use().waitForExecution(unversioned, id);
        return result.value;
      })
      .build();

    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          test.durableRegistration,
          v1,
          v2,
          unversioned,
          parent,
          legacyParent,
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const backend = runtime.getResourceValue(durable);
      const correct = await backend.start(v1);
      const mismatch = await backend.start(v2);
      const unversionedId = await backend.start(unversioned);
      const parentId = await backend.start(parent, correct);
      await expect(backend.wait(parentId, { timeout: 1_000 })).resolves.toBe(
        42,
      );
      const wrongParent = await backend.start(parent, mismatch);
      await expect(
        backend.wait(wrongParent, { timeout: 1_000 }),
      ).rejects.toThrow(
        /as workflow 'child' version 1: the stored execution uses version 2/,
      );
      const waitingOnLegacy = await backend.start(parent, unversionedId);
      await expect(
        backend.wait(waitingOnLegacy, { timeout: 1_000 }),
      ).rejects.toThrow(
        /as workflow 'child' version 1: the stored execution uses version unversioned/,
      );
      const legacyWaitingOnVersioned = await backend.start(
        legacyParent,
        correct,
      );
      await expect(
        backend.wait(legacyWaitingOnVersioned, { timeout: 1_000 }),
      ).rejects.toThrow(
        /as workflow 'child' version unversioned: the stored execution uses version 1/,
      );
    } finally {
      await runtime.dispose();
    }
  });
});
