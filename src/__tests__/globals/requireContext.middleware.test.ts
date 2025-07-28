import { requireContextMiddleware } from "../../globals/middleware/requireContext.middleware";
import { ContextError } from "../../context";

/**
 * Utility function to build a fake Context implementation that allows us to
 * control the behaviour of the `use()` call during each test.
 */
function createFakeContext<T>(useImplementation: () => T) {
  return {
    /** unique id is irrelevant for tests */
    id: Symbol("fake-context"),
    // `use` is what we care about – we wire whatever behaviour the test needs
    use: jest.fn(useImplementation),
    // The following members are not used by the middleware but are required
    // to satisfy the `Context` interface.
    provide: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    require: jest.fn() as any,
  } as any;
}

describe("requireContextMiddleware", () => {
  it("throws if the middleware receives no context in its config", async () => {
    // Arrange → no context passed
    const next = jest.fn();

    // Act & Assert
    await expect(
      requireContextMiddleware.run({ next } as any, {} as any, {} as any)
    ).rejects.toThrow(
      "Context not available. Did you forget to pass 'context' to the middleware?"
    );
  });

  it("throws ContextError when the context has not been provided", async () => {
    // Arrange → a context whose `use` returns undefined, simulating missing provider
    const fakeContext = createFakeContext(() => undefined);
    const next = jest.fn();

    // Act & Assert
    await expect(
      requireContextMiddleware.run(
        { next } as any,
        {} as any,
        { context: fakeContext } as any
      )
    ).rejects.toBeInstanceOf(ContextError);
  });

  it("passes task.input to next() and returns its result when called within a task", async () => {
    const fakeContext = createFakeContext(() => ({ user: "alice" }));
    const task = { input: "payload" };
    const expectedResult = "task-result";
    const next = jest.fn().mockResolvedValue(expectedResult);

    const result = await requireContextMiddleware.run(
      { task, next } as any,
      {} as any,
      { context: fakeContext } as any
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(task.input);
    expect(result).toBe(expectedResult);
  });

  it("passes resource.config to next() and returns its result when called within a resource", async () => {
    const fakeContext = createFakeContext(() => ({ user: "bob" }));
    const resource = { config: { url: "https://example.com" } };
    const expectedResult = "resource-result";
    const next = jest.fn().mockResolvedValue(expectedResult);

    const result = await requireContextMiddleware.run(
      { resource, next } as any,
      {} as any,
      { context: fakeContext } as any
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(resource.config);
    expect(result).toBe(expectedResult);
  });

  it("calls next() with no arguments when neither task nor resource is provided", async () => {
    const fakeContext = createFakeContext(() => ({ user: "charlie" }));
    const next = jest.fn().mockResolvedValue("noop-result");

    const result = await requireContextMiddleware.run(
      { next } as any,
      {} as any,
      { context: fakeContext } as any
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(result).toBe("noop-result");
  });
});
