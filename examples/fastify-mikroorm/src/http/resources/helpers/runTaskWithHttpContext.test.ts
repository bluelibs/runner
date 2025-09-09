import { runTaskWithHttpContext } from "./runTaskWithHttpContext";

describe("runTaskWithHttpContext", () => {
  it("provides context and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const reply = { statusCode: 201 } as any;
    const result = await runTaskWithHttpContext({
      taskRunner: { run: async (_task: any, input: number) => input + 1 },
      task: {},
      input: 1,
      fastifyContext: { provide: (_v: any, cb: any) => cb() },
      contextValues: { request: {}, reply, requestId: "r1", user: null, userId: null, logger: {} },
      onSuccess,
      onError,
    });
    expect(result).toBe(2);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 201 }));
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError and rethrows on failure", async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const err = new Error("fail");
    await expect(
      runTaskWithHttpContext({
        taskRunner: { run: async () => { throw err; } },
        task: {},
        input: {},
        fastifyContext: { provide: (_v: any, cb: any) => cb() },
        contextValues: { request: {}, reply: { statusCode: 200 } as any, requestId: "r2", user: null, userId: null, logger: {} },
        onSuccess,
        onError,
      }),
    ).rejects.toThrow(err);
    expect(onError).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("defaults status code to 200 when undefined", async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const reply = {} as any; // no statusCode
    await runTaskWithHttpContext({
      taskRunner: { run: async () => "ok" },
      task: {},
      input: {},
      fastifyContext: { provide: (_v: any, cb: any) => cb() },
      contextValues: { request: {}, reply, requestId: "r3", user: null, userId: null, logger: {} },
      onSuccess,
      onError,
    });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200 }));
  });
});
