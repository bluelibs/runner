import { middlewareInterceptorResource } from "../../globals/resources/debug/middleware.hook";

describe("globals.resources.debug.middlewareInterceptorResource (unit)", () => {
  it("logs before and after for resource and task middleware via interceptors", async () => {
    const messages: string[] = [];

    const logger = {
      info: async (message: string) => {
        messages.push(String(message));
      },
    } as any;

    const interceptCalls: Array<{
      kind: "task" | "resource";
    }> = [];

    // Fake middlewareManager that immediately invokes provided interceptor with a sample input
    const middlewareManager = {
      intercept: (kind: "task" | "resource", interceptor: any) => {
        interceptCalls.push({ kind });
        if (kind === "resource") {
          return interceptor(
            async (_input: any) =>
              new Promise((resolve) => setTimeout(() => resolve(undefined), 0)),
            {
              resource: { definition: { id: "tests.resource" }, config: {} },
              next: async () => undefined,
            },
          );
        } else {
          return interceptor(
            async (_input: any) =>
              new Promise((resolve) => setTimeout(() => resolve(undefined), 0)),
            {
              task: { definition: { id: "tests.task" }, input: {} },
              next: async () => undefined,
            },
          );
        }
      },
    } as any;

    // Pass verbose config so before/after flags are true
    await middlewareInterceptorResource.init?.(
      undefined as any,
      {
        logger,
        debugConfig: "verbose",
        middlewareManager,
      } as any,
      undefined as any,
    );

    // Allow async interceptor to finish and log "completed" messages
    await new Promise((resolve) => setTimeout(resolve, 0));

    const joined = messages.join("\n");
    expect(joined.includes("Middleware triggered for task tests.task")).toBe(
      true,
    );
    expect(joined.includes("Middleware completed for task tests.task")).toBe(
      true,
    );
    expect(
      joined.includes("Middleware triggered for resource tests.resource"),
    ).toBe(true);
    expect(
      joined.includes("Middleware completed for resource tests.resource"),
    ).toBe(true);

    // Ensure both intercept registrations were attempted
    expect(interceptCalls.some((c) => c.kind === "task")).toBe(true);
    expect(interceptCalls.some((c) => c.kind === "resource")).toBe(true);
  });
});
