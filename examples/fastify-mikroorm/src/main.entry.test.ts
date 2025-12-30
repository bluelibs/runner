describe("main entry", () => {
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
      jest.doMock("@bluelibs/runner", () => ({
        run: () => Promise.resolve({ logger: { info: jest.fn() } }),
        resource: (x: any) => x,
        r: {
          resource: (id: string) => ({
            register: () => ({ build: () => ({}) }),
          }),
        },
        globals: { resources: { logger: {} } },
      }));
      jest.doMock("@bluelibs/runner-dev", () => ({
        dev: { with: (_: any) => ({}) },
      }));
      jest.doMock("./db/resources", () => ({ db: {}, fixtures: {} }));
      jest.doMock("./http", () => ({ http: {} }));
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
        jest.doMock("@bluelibs/runner", () => ({
          run: () => Promise.reject(error),
          resource: (x: any) => x,
          r: {
            resource: (id: string) => ({
              register: () => ({ build: () => ({}) }),
            }),
          },
          globals: { resources: { logger: {} } },
        }));
        jest.doMock("@bluelibs/runner-dev", () => ({
          dev: { with: (_: any) => ({}) },
        }));
        jest.doMock("./db/resources", () => ({ db: {}, fixtures: {} }));
        jest.doMock("./http", () => ({ http: {} }));
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
