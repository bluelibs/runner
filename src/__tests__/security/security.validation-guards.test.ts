// This suite focuses on input validation as a security boundary.
// The task should never execute its run() logic if input validation fails.
// This prevents malformed or malicious input from entering business logic.
import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("Security: Validation guards", () => {
  it("rejects invalid task input before execution", async () => {
    // The inputSchema ensures only valid emails pass through. We intentionally
    // supply an invalid email string to assert the ValidationError is thrown
    // by the framework before task.run is invoked.
    const task = defineTask<{ email: string }>({
      id: "sec.tasks.createUser",
      inputSchema: {
        parse: (input: any) => {
          if (!input || typeof input.email !== "string" || !input.email.includes("@")) {
            throw new Error("Invalid email");
          }
          return input;
        },
      },
      run: async () => {
        // If validation fails, we should never reach here
        return { ok: true };
      },
    });

    const app = defineResource({ id: "sec.app", register: [task] });
    const rr = await run(app);

    await expect(rr.runTask(task as any, { email: "not-an-email" } as any)).rejects.toThrow(
      /Task input validation/i,
    );

    await rr.dispose();
  });
});
