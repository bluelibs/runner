import { defineResource, defineTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { run } from "../../run";

describe("tags.failWhenUnhealthy", () => {
  it("blocks tagged tasks when a monitored resource is unhealthy", async () => {
    const db = defineResource({
      id: "task-health-db-unhealthy",
      async init() {
        return { connected: false };
      },
      async health(value) {
        return { status: value?.connected ? "healthy" : "unhealthy" };
      },
    });

    const task = defineTask({
      id: "task-health-blocked",
      tags: [globalTags.failWhenUnhealthy.with(["task-health-db-unhealthy"])],
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "task-health-blocked-app",
      register: [db, task],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    await expect(runtime.runTask(task)).rejects.toMatchObject({
      id: "taskBlockedByResourceHealth",
    });

    await runtime.dispose();
  });

  it("allows degraded resources and skips sleeping lazy ones", async () => {
    const degradedDb = defineResource({
      id: "task-health-db-degraded",
      async init() {
        return { latencyMs: 200 };
      },
      async health() {
        return { status: "degraded" as const };
      },
    });

    const sleepingDb = defineResource({
      id: "task-health-db-sleeping",
      async init() {
        return { connected: true };
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const task = defineTask({
      id: "task-health-allowed",
      tags: [globalTags.failWhenUnhealthy.with([degradedDb, sleepingDb])],
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "task-health-allowed-app",
      register: [degradedDb, sleepingDb, task],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      lazy: true,
      shutdownHooks: false,
    });

    await expect(runtime.runTask(task)).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("does not enforce the policy during bootstrap task calls", async () => {
    const db = defineResource({
      id: "task-health-bootstrap-db",
      async init() {
        return { connected: false };
      },
      async health() {
        return { status: "unhealthy" as const };
      },
    });

    const task = defineTask({
      id: "task-health-bootstrap-task",
      tags: [globalTags.failWhenUnhealthy.with([db])],
      async run() {
        return "ok";
      },
    });

    const probe = defineResource({
      id: "task-health-bootstrap-probe",
      dependencies: { task },
      async init(_config, { task }) {
        await expect(task()).resolves.toBe("ok");
        return "probe-ready";
      },
    });

    const app = defineResource({
      id: "task-health-bootstrap-app",
      register: [db, task, probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    await runtime.dispose();
  });

  it("fails fast when a monitored resource does not implement health()", async () => {
    const db = defineResource({
      id: "task-health-missing-probe-db",
      async init() {
        return { connected: true };
      },
    });

    const task = defineTask({
      id: "task-health-missing-probe-task",
      tags: [globalTags.failWhenUnhealthy.with([db])],
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "task-health-missing-probe-app",
      register: [db, task],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    await expect(runtime.runTask(task)).rejects.toMatchObject({
      id: "taskHealthResourceNotReportable",
    });

    await runtime.dispose();
  });

  it("fails fast for unresolved resource references", async () => {
    const detached = defineResource({
      id: "task-health-detached-resource",
      async init() {
        return { connected: true };
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const task = defineTask({
      id: "task-health-detached-task",
      tags: [globalTags.failWhenUnhealthy.with([detached])],
      async run() {
        return "ok";
      },
    });

    const app = defineResource({
      id: "task-health-detached-app",
      register: [task],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    await expect(runtime.runTask(task)).rejects.toThrow(
      `Definition "${detached.id}" not found.`,
    );

    await runtime.dispose();
  });
});
