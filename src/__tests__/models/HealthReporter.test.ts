import { HealthReporter } from "../../models/HealthReporter";

describe("HealthReporter", () => {
  it("falls back to raw string ids when alias resolution is unavailable", () => {
    const reporter = new HealthReporter({
      resolveDefinitionId: () => undefined,
    } as any);

    expect((reporter as any).resolveResourceId("raw-health-id")).toBe(
      "raw-health-id",
    );
  });

  it("falls back to raw object ids when alias resolution is unavailable", () => {
    const reporter = new HealthReporter({
      resolveDefinitionId: () => undefined,
    } as any);

    expect(
      (reporter as any).resolveResourceId({ id: "raw-health-object-id" }),
    ).toBe("raw-health-object-id");
  });

  it("stringifies unresolved object references without ids", () => {
    const reporter = new HealthReporter({
      resolveDefinitionId: () => undefined,
    } as any);

    expect((reporter as any).resolveResourceId({ missing: true })).toBe(
      "[object Object]",
    );
  });

  it("supports getHealth() without an explicit access policy", async () => {
    const reporter = new HealthReporter({
      resolveDefinitionId: () => "health-resource",
      resources: new Map([
        [
          "health-resource",
          {
            resource: {
              id: "health-resource",
              health: async () => ({ status: "healthy" as const }),
            },
            config: undefined,
            value: undefined,
            context: {},
            isInitialized: true,
          },
        ],
      ]),
    } as any);

    const report = await reporter.getHealth();

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.report).toEqual([
      expect.objectContaining({
        id: "health-resource",
        initialized: true,
        status: "healthy",
      }),
    ]);
  });

  it("passes an empty dependency object when computed dependencies are absent", async () => {
    const health = jest.fn(async () => ({ status: "healthy" as const }));
    const reporter = new HealthReporter({
      resolveDefinitionId: () => "health-resource",
      resources: new Map([
        [
          "health-resource",
          {
            resource: {
              id: "health-resource",
              health,
            },
            config: undefined,
            value: undefined,
            context: {},
            isInitialized: true,
          },
        ],
      ]),
      getRuntimeMetadata: () => ({
        id: "health-resource",
        path: "app.health-resource",
        runtimeId: "app.health-resource",
      }),
    } as any);

    await reporter.getHealth(["health-resource"], {
      ensureAvailable: () => undefined,
    });

    expect(health).toHaveBeenCalledWith(undefined, undefined, {}, {});
  });
});
