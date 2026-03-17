import { defineResource } from "../../define";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";

describe("runner.health", () => {
  it("exposes a narrow health reporter resource", async () => {
    const monitored = defineResource({
      id: "health-resource-monitored",
      async init() {
        return { ok: true };
      },
      async health(value) {
        return {
          status: value?.ok ? "healthy" : "unhealthy",
          message: "checked",
        };
      },
    });

    const snapshot: {
      bootstrapBlocked?: boolean;
      hasRuntimeApi?: boolean;
    } = {};

    const probe = defineResource({
      id: "health-resource-probe",
      dependencies: { health: globalResources.health },
      async init(_config, { health }) {
        await expect(health.getHealth([monitored])).rejects.toMatchObject({
          id: "runtimeHealthDuringBootstrap",
        });
        snapshot.bootstrapBlocked = true;
        snapshot.hasRuntimeApi = "runTask" in (health as object);
        return "ok";
      },
    });

    const app = defineResource({
      id: "health-resource-app",
      register: [monitored, probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const health = runtime.getResourceValue(globalResources.health);
    const report = await health.getHealth([monitored]);

    expect(snapshot).toEqual({
      bootstrapBlocked: true,
      hasRuntimeApi: false,
    });
    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.find(monitored)?.status).toBe("healthy");
    expect(report.find("health-resource-monitored")?.status).toBe("healthy");

    await runtime.dispose();
  });

  it("does not carry the deprecated system tag", () => {
    expect(globalResources.health.tags?.includes(globalTags.system)).toBe(
      false,
    );
  });

  it("rejects health checks once disposal has started", async () => {
    const monitored = defineResource({
      id: "health-resource-dispose-monitored",
      async init() {
        return "ready";
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const app = defineResource({
      id: "health-resource-dispose-app",
      register: [monitored],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const health = runtime.getResourceValue(globalResources.health);

    const disposePromise = runtime.dispose();

    await expect(health.getHealth([monitored])).rejects.toMatchObject({
      id: "runResultDisposed",
    });

    await disposePromise;
  });
});
