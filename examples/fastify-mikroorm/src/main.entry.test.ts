describe("main entry", () => {
  const identity = <T>(value: T) => value;
  const createRunnerMock = (runFn: () => Promise<unknown>) => ({
    run: runFn,
    resource: identity,
    r: {
      resource: (_id: string) => ({
        register: () => ({ build: () => ({}) }),
      }),
      runner: { logger: {} },
      system: {},
    },
  });

  const ORIG_ENV = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIG_ENV };
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  it("invokes run and resolves without crashing", async () => {
    jest.isolateModules(() => {
      jest.doMock("@bluelibs/runner", () =>
        createRunnerMock(() => Promise.resolve({ logger: { info: jest.fn() } })),
      );
      jest.doMock("@bluelibs/runner-dev", () => ({
        dev: { with: identity },
      }));
      jest.doMock("./db/resources", () => ({ db: {}, fixtures: {} }));
      jest.doMock("./web", () => ({ http: {} }));
      jest.doMock("./users", () => ({ users: {} }));
      jest.doMock("./general", () => ({ env: {} }));
      // Importing main should not throw
      require("./main");
    });
  });

  it("logs and exits on run() rejection", async () => {
    const error = new Error("boom");
    const spy = jest.spyOn(console, "error").mockImplementation(() => void 0);
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);

    await new Promise<void>((resolve) => {
      jest.isolateModules(() => {
        jest.doMock("@bluelibs/runner", () =>
          createRunnerMock(() => Promise.reject(error)),
        );
        jest.doMock("@bluelibs/runner-dev", () => ({
          dev: { with: identity },
        }));
        jest.doMock("./db/resources", () => ({ db: {}, fixtures: {} }));
        jest.doMock("./web", () => ({ http: {} }));
        jest.doMock("./users", () => ({ users: {} }));
        jest.doMock("./general", () => ({ env: {} }));
        require("./main");
        // allow promise microtask to settle
        setImmediate(resolve);
      });
    });

    expect(spy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    spy.mockRestore();
  });
});
