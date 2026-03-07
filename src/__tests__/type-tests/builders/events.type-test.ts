import { r } from "../../../";
import { isOneOf, onAnyOf } from "../../../types/event";
import type { IEventEmitReport } from "../../../types/event";
import type { HookRevertFn } from "../../../types/hook";

// Type-only tests for builder event and hook typing.

// Scenario: builder hooks should enforce payload and dependency types.
{
  const hookEvent = r
    .event("hook-event")
    .payloadSchema<{ message: string }>({ parse: (x: any) => x })
    .build();

  const task = r
    .task("task")
    .run(async () => "Task executed")
    .build();

  r.hook("test-hook")
    .dependencies({ task })
    .on(hookEvent)
    .run(async (event, deps) => {
      event.data.message;
      // @ts-expect-error
      event.data.messagex;
      deps.task();
      // @ts-expect-error
      deps.task2x;
    })
    .build();

  r.hook("test-hook2")
    .dependencies({ task })
    .on("*")
    .run(async (event, deps) => {
      event.data.message;
      event.data.messagex;
      deps.task();
      // @ts-expect-error
      deps.task2x;
    })
    .build();
}

// Scenario: transactional events require hook undo closures when known at type level.
{
  const txEvent = r.event("events-type-tx").transactional().build();
  const nonTxEvent = r.event("events-type-non-tx").build();

  r.hook("events-type-tx-hook-ok")
    .on(txEvent)
    .run(async () => {
      const revert: HookRevertFn = async () => {};
      return revert;
    })
    .build();

  r.hook("events-type-tx-hook-non-tx")
    .on(nonTxEvent)
    .run(async () => {})
    .build();

  r.hook("events-type-tx-hook-mixed-ok")
    .on([txEvent, nonTxEvent] as const)
    .run(async () => async () => {})
    .build();

  r.hook("events-type-tx-hook-wildcard-runtime")
    .on("*")
    .run(async () => {})
    .build();

  r.hook("events-type-tx-hook-fail")
    .on(txEvent)
    // @ts-expect-error transactional hooks must return undo closure
    .run(async () => {})
    .build();

  r.hook("events-type-tx-hook-mixed-fail")
    .on([txEvent, nonTxEvent] as const)
    // @ts-expect-error mixed subscriptions including transactional events must return undo closure
    .run(async () => {})
    .build();
}

// Scenario: event dependency emitter infers report type from literal options.
{
  const ev = r
    .event("events-type-infer-report")
    .payloadSchema<{ id: string }>({ parse: (x: any) => x })
    .build();

  r.task("events-type-infer-report-task")
    .dependencies({ ev })
    .run(async (_input, deps) => {
      const directReport = await deps.ev({ id: "1" }, { report: true });
      const reportValue: IEventEmitReport = directReport;
      reportValue.failedListeners;

      const literalOptions = {
        report: true as const,
        throwOnError: false,
      };
      const literalReport = await deps.ev({ id: "2" }, literalOptions);
      const literalReportValue: IEventEmitReport = literalReport;
      literalReportValue.errors;

      const dynamicOptions: { report?: boolean } = {};
      const dynamicResult = await deps.ev({ id: "3" }, dynamicOptions);
      // @ts-expect-error dynamic report flag yields union
      const mustBeReport: IEventEmitReport = dynamicResult;

      return "ok";
    })
    .build();
}

// Scenario: multi-event hooks should expose only common payload fields.
{
  const e1 = r
    .event("e1")
    .payloadSchema<{ a: string; b: number; common: number }>({
      parse: (x: any) => x,
    })
    .build();
  const e2 = r
    .event("e2")
    .payloadSchema<{ a: string; c: boolean; common: number }>({
      parse: (x: any) => x,
    })
    .build();
  const e3 = r
    .event("e3")
    .payloadSchema<{ a: string; b: number; d?: string; common: number }>({
      parse: (x: any) => x,
    })
    .build();

  r.hook("hook-common")
    .on([e1, e2, e3] as const)
    .run(async (event) => {
      event.data.a;
      event.data.common;
      // @ts-expect-error b is not common to all
      event.data.b;
      // @ts-expect-error c is not common to all
      event.data.c;
    })
    .build();

  r.hook("hook-helper")
    .on(onAnyOf(e1, e3))
    .run(async (event) => {
      event.data.a;
      event.data.common;
      // @ts-expect-error c is not common to all
      event.data.c;
      // @ts-expect-error d is not common to all
      event.data.d;
    })
    .build();

  r.hook("hook-guard")
    .on([e1, e2])
    .run(async (event) => {
      if (isOneOf(event, [e2, e1])) {
        event.data.a;
        event.data.common;
        // @ts-expect-error c not present in either
        event.data.c;
        // @ts-expect-error b not common
        event.data.b;
      }
    })
    .build();
}
