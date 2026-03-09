describe("mikro-orm.config bootstrap", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
  });
  afterAll(() => {
    process.env = origEnv;
  });

  it("builds config via run(cli) and defineConfig", async () => {
    const mockCfg = { some: "config" } as any;
    const defineSpy = jest.fn((x) => x);
    const buildSpy = jest.fn(() => "cli");
    const registerSpy = jest.fn(() => ({ build: buildSpy }));

    jest.isolateModules(async () => {
      jest.doMock("@bluelibs/runner", () => ({
        r: {
          resource: jest.fn(() => ({ register: registerSpy })),
        },
        run: async () => ({ getResourceValue: () => mockCfg }),
      }));
      jest.doMock("@mikro-orm/core", () => ({ defineConfig: defineSpy }));
      // Avoid loading real MikroORM entity code
      jest.doMock("./resources/entities", () => ({}));
      jest.doMock("./resources/orm.config", () => ({ ormConfig: {} }));

      const exported = require("./mikro-orm.config.ts");
      const result = await exported;
      expect(defineSpy).toHaveBeenCalledWith(mockCfg);
      expect(result).toBe(mockCfg);
    });
  });
});
