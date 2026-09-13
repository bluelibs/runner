import { requireContextTaskMiddleware } from "../../globals/middleware/requireContext.middleware";
import { genericError } from "../../errors";

/**
 * Utility function to build a fake Context implementation that allows us to
 * control the behaviour of the `use()` call during each test.
 */
function createFakeContext<T>(useImplementation: () => T) {
  return {
    use: jest.fn(useImplementation),
  };
}

describe("requireContextMiddleware", () => {
  it("throws if the middleware receives no context in its config", async () => {
    // Arrange → no context passed
    const next = jest.fn();

    // Act & Assert
    await expect(
      requireContextTaskMiddleware.run({ next } as any, {} as any, {} as any),
    ).rejects.toThrow(
      "Context not available. Did you forget to pass 'context' to the middleware?",
    );
  });

  it("throws ContextError when the context has not been provided", async () => {
    // Arrange → a context whose `use` returns undefined, simulating missing provider
    const fakeContext = createFakeContext(() => {
      // ContextError is now a helper; we only check that an error is thrown
      throw genericError.new({
        message:
          "Context not available. Did you forget to provide the context via ContextName.provide()?",
      });
    });
    const next = jest.fn();

    // Act & Assert
    await expect(
      requireContextTaskMiddleware.run({ next } as any, {} as any, {
        context: fakeContext,
      }),
    ).rejects.toThrow();
  });

  it("passes task.input to next() and returns its result when called within a task", async () => {
    const fakeContext = createFakeContext(() => ({ user: "alice" }));
    const task = { input: "payload" };
    const expectedResult = "task-result";
    const next = jest.fn().mockResolvedValue(expectedResult);

    const result = await requireContextTaskMiddleware.run(
      { task, next } as any,
      {} as any,
      { context: fakeContext },
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(task.input);
    expect(result).toBe(expectedResult);
  });

  // resource path removed for task-only requireContextMiddleware
});
