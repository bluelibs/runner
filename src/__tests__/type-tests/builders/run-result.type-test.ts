import { r, run } from "../../../";
import { EventEmissionFailureMode } from "../../../defs";
import type { IEventEmitReport } from "../../../types/event";

// Type-only tests for builder RunResult typing.

// Scenario: runTask should enforce input/output and dependency override signatures.
void (async () => {
  type Input = { x: number };

  const add = r
    .task("types.add")
    .inputSchema<Input>({ parse: (x: any) => x })
    .run(async (input: Input) => input.x + 1)
    .build();

  const depTask = r
    .task("types.dep")
    .inputSchema<{ v: string }>({ parse: (x: any) => x })
    .run(async (input) => input.v.toUpperCase())
    .build();

  const main = r
    .task("types.main")
    .dependencies({ depTask })
    .inputSchema<Input>({ parse: (x: any) => x })
    .run(async (input, deps) => {
      const value = await deps.depTask({ v: String(input.x) });
      return Number(value) + 1;
    })
    .build();

  const app = r.resource("types.app").register([add, depTask, main]).build();
  const harness = r.resource("types.harness").register([app]).build();

  const rr = await run(harness);
  const valid1: number | undefined = await rr.runTask(add, { x: 1 });
  void valid1;

  // @ts-expect-error wrong input type
  await rr.runTask(add, { z: 1 });
  // @ts-expect-error missing input
  await rr.runTask(add);

  const valid2: number | undefined = await rr.runTask(main, { x: 2 });
  void valid2;

  // @ts-expect-error wrong deps override type
  await rr.runTask(main, { x: 2 }, { depTask: async (input: number) => "x" });
})();

// Scenario: emitEvent return type depends on literal report option.
void (async () => {
  const evt = r
    .event("types.emitEvent.builder")
    .payloadSchema<{ id: string }>({ parse: (x: any) => x })
    .build();

  const app = r.resource("types.emitEvent.builder.app").register([evt]).build();
  const rr = await run(app);

  const noReport = await rr.emitEvent(evt, { id: "1" });
  const voidValue: void = noReport;
  void voidValue;

  const report = await rr.emitEvent(evt, { id: "2" }, { report: true });
  const reportValue: IEventEmitReport = report;
  reportValue.errors;

  const strictReport = await rr.emitEvent(
    evt,
    { id: "3" },
    {
      report: true as const,
      throwOnError: false,
      failureMode: EventEmissionFailureMode.Aggregate,
    },
  );
  const strictReportValue: IEventEmitReport = strictReport;
  strictReportValue.failedListeners;

  const dynamicOptions: { report?: boolean } = {};
  const dynamicResult = await rr.emitEvent(evt, { id: "4" }, dynamicOptions);
  // @ts-expect-error dynamic report option yields a union return type
  const mustBeReport: IEventEmitReport = dynamicResult;
})();
