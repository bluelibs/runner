import { HealthReporter } from "../../models/HealthReporter";

describe("HealthReporter", () => {
  it("falls back to raw string ids when alias resolution is unavailable", () => {
    const reporter = new HealthReporter(
      {
        resolveDefinitionId: () => undefined,
      } as any,
      {
        ensureAvailable: () => undefined,
      },
    );

    expect((reporter as any).resolveResourceId("raw-health-id")).toBe(
      "raw-health-id",
    );
  });

  it("falls back to raw object ids when alias resolution is unavailable", () => {
    const reporter = new HealthReporter(
      {
        resolveDefinitionId: () => undefined,
      } as any,
      {
        ensureAvailable: () => undefined,
      },
    );

    expect(
      (reporter as any).resolveResourceId({ id: "raw-health-object-id" }),
    ).toBe("raw-health-object-id");
  });

  it("passes an empty dependency object when computed dependencies are absent", async () => {
    const health = jest.fn(async () => ({ status: "healthy" as const }));
    const reporter = new HealthReporter(
      {
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
      } as any,
      {
        ensureAvailable: () => undefined,
      },
    );

    await reporter.getHealth(["health-resource"]);

    expect(health).toHaveBeenCalledWith(undefined, undefined, {}, {});
  });
});
