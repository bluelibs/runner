/**
 * Quick test to debug dependency resolution
 */

import { run } from "../../run";
import { defineResource as resource } from "../../define";
import { memoryWorkflowResource } from "../../globals/resources/workflow.resource";

describe("Workflow Dependency Debug", () => {
  it("should register workflow resource correctly", async () => {
    console.log("memoryWorkflowResource:", memoryWorkflowResource);
    console.log("memoryWorkflowResource.id:", memoryWorkflowResource.id);
    console.log("memoryWorkflowResource init:", typeof memoryWorkflowResource.init);
    
    const app = resource({
      id: "debug.app",
      register: [memoryWorkflowResource],
      init: async () => {
        return { success: true };
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });
});