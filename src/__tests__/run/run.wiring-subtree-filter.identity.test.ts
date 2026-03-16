import { defineResource, defineTask } from "../../define";
import { subtreeOf } from "../../public";
import { run } from "../../run";

const POLICY_VIOLATION_ID = "isolationViolation";

describe("subtreeOf() identity resolution", () => {
  it("resolves the original resource reference when sibling resources share a local id", async () => {
    const leftTask = defineTask({
      id: "shared-task",
      run: async () => "left",
    });
    const rightTask = defineTask({
      id: "shared-task",
      run: async () => "right",
    });

    const leftShared = defineResource({
      id: "shared",
      register: [leftTask],
    });
    const rightShared = defineResource({
      id: "shared",
      register: [rightTask],
    });

    const leftParent = defineResource({
      id: "left",
      register: [leftShared],
    });
    const rightParent = defineResource({
      id: "right",
      register: [rightShared],
    });

    const consumer = defineTask({
      id: "consumer",
      dependencies: { leftTask },
      run: async (_input, deps) => deps.leftTask(),
    });

    const boundary = defineResource({
      id: "boundary",
      isolate: { deny: [subtreeOf(leftShared)] },
      register: [consumer],
    });

    const app = defineResource({
      id: "subtree-identity-app",
      register: [leftParent, rightParent, boundary],
    });

    await expect(run(app)).rejects.toMatchObject({
      id: POLICY_VIOLATION_ID,
    });
  });
});
