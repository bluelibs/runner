import { defineEvent, defineResource, defineTask } from "../../../define";
import { EventEmissionFailureMode } from "../../../defs";
import { run, system } from "../../../";
import type { IEventEmitReport } from "../../../types/event";
import type { ExecutionRecordResult } from "../../../types/executionContext";
import type { IResourceHealthReport } from "../../../types/resource";
import { RunnerMode } from "../../../types/runner";

// Type-only tests for RunResult API typing.

// Scenario: RunResult.runTask should enforce input and dependency overrides.
void (async () => {
  type Input = { x: number };
  type Output = Promise<number>;

  const add = defineTask<Input, Output>({
    id: "types-add",
    run: async (input) => input.x + 1,
  });

  const depTask = defineTask<{ v: string }, Promise<string>>({
    id: "types-dep",
    run: async (input) => input.v.toUpperCase(),
  });

  const main = defineTask<Input, Output, { depTask: typeof depTask }>({
    id: "types-main",
    dependencies: { depTask },
    run: async (input, deps) => {
      const value = await deps.depTask({ v: String(input.x) });
      return Number(value) + 1;
    },
  });

  const app = defineResource({
    id: "types-app",
    register: [add, depTask, main],
  });
  const harness = defineResource({ id: "types-harness", register: [app] });

  const rr = await run(harness);
  const valid1: number | undefined = await rr.runTask(add, { x: 1 });
  void valid1;

  // @ts-expect-error wrong input type
  await rr.runTask(add, { z: 1 });
  // @ts-expect-error missing input
  await rr.runTask(add);

  const valid2: number | undefined = await rr.runTask(main, { x: 2 });
  void valid2;

  const withContext = await system.ctx.executionContext.record(() =>
    rr.runTask(add, { x: 3 }),
  );
  const withContextValue: ExecutionRecordResult<number | undefined> =
    withContext;
  withContextValue.recording?.correlationId;

  // @ts-expect-error wrong deps override type
  await rr.runTask(main, { x: 2 }, { depTask: async (input: number) => "x" });
})();

// Scenario: RunResult.getHealth returns the aggregate health report type.
void (async () => {
  const healthy = defineResource({
    id: "types-health-resource",
    async init() {
      return { ok: true };
    },
    async health(value) {
      return {
        status: value?.ok ? "healthy" : "unhealthy",
        message: "checked",
      } as const;
    },
  });

  const ignored = defineResource({
    id: "types-health-ignored",
    async init() {
      return { ok: true };
    },
  });

  const app = defineResource({
    id: "types-health-app",
    register: [healthy, ignored],
  });

  const rr = await run(app);
  const report = await rr.getHealth([healthy, ignored]);
  const typedReport: IResourceHealthReport = report;
  const resources: number = typedReport.totals.resources;
  const firstStatus: "healthy" | "degraded" | "unhealthy" | undefined =
    typedReport.report[0]?.status;
  const findStatus: "healthy" | "degraded" | "unhealthy" =
    typedReport.find(healthy).status;

  void resources;
  void firstStatus;
  void findStatus;

  await rr.getHealth(["types-health-resource"]);
})();

// Scenario: RunResult.getResourceConfig should preserve resource config typing.
void (async () => {
  type Config = { region: "us" | "eu"; retries: number };

  const client = defineResource<Config, Promise<{ ok: true }>>({
    id: "types-resource-config-client",
    init: async () => ({ ok: true }),
  });

  const app = defineResource({
    id: "types-resource-config-app",
    register: [client.with({ region: "us", retries: 3 })],
  });

  const rr = await run(app);
  const config = rr.getResourceConfig(client);
  const region: "us" | "eu" = config.region;
  const retries: number = config.retries;

  const configById = rr.getResourceConfig("types-resource-config-client");
  const idRetries: number = (configById as Config).retries;

  void region;
  void retries;
  void idRetries;
})();

// Scenario: RunResult.emitEvent infers report type from literal options.
void (async () => {
  const appEvent = defineEvent<{ v: number }>({
    id: "types-emitEvent-define",
  });

  const app = defineResource({
    id: "types-emitEvent-define-root",
    register: [appEvent],
  });

  const rr = await run(app);

  const noReport = await rr.emitEvent(appEvent, { v: 1 });
  const voidValue: void = noReport;
  void voidValue;

  const report = await rr.emitEvent(appEvent, { v: 2 }, { report: true });
  const reportValue: IEventEmitReport = report;
  reportValue.attemptedListeners;

  const strictReport = await rr.emitEvent(
    appEvent,
    { v: 3 },
    {
      report: true as const,
      throwOnError: false,
      failureMode: EventEmissionFailureMode.Aggregate,
    },
  );
  const strictReportValue: IEventEmitReport = strictReport;
  strictReportValue.failedListeners;

  const dynamicOptions: { report?: boolean } = {};
  const dynamic = await rr.emitEvent(appEvent, { v: 4 }, dynamicOptions);
  // @ts-expect-error dynamic report option yields union
  const mustBeReport: IEventEmitReport = dynamic;

  const withContext = await system.ctx.executionContext.record(() =>
    rr.emitEvent(appEvent, { v: 5 }, { report: true }),
  );
  const withContextReport: ExecutionRecordResult<IEventEmitReport> =
    withContext;
  withContextReport.result.attemptedListeners;
})();

// Scenario: RunResult exposes the root definition for generic resource access.
void (async () => {
  type RootConfig = { mode: "dev" | "prod" };
  type RootValue = { ready: true };

  const app = defineResource<RootConfig, Promise<RootValue>>({
    id: "types-root-app",
    init: async () => ({ ready: true }),
  });

  const rr = await run(app.with({ mode: "dev" }));
  const rootId: string = rr.root.id;
  const rootConfig = rr.getResourceConfig<RootConfig>(rr.root);
  const mode: "dev" | "prod" = rootConfig.mode;
  const rootValue = rr.getResourceValue(rr.root);
  const ready: true = rootValue.ready;

  void rootId;
  void mode;
  void ready;
})();

// Scenario: RunResult exposes normalized runOptions typing.
void (async () => {
  const app = defineResource({
    id: "types-run-options-app",
  });

  const rr = await run(app, { mode: RunnerMode.PROD, executionContext: true });
  const runtimeMode: RunnerMode = rr.runOptions.mode;
  const printThreshold = rr.runOptions.logs.printThreshold;
  const cycleDetection = rr.runOptions.executionContext?.cycleDetection;
  const maxDepth: number | undefined = cycleDetection?.maxDepth;

  void runtimeMode;
  void printThreshold;
  void maxDepth;
})();
