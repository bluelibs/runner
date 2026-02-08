import { defineEvent, defineHook, defineTask } from "../../../define";
import { isOneOf, onAnyOf } from "../../../types/event";

// Type-only tests for define event and hook typing.

// Scenario: hooks should enforce event payload and dependency access.
{
  const hookEvent = defineEvent<{ message: string }>({ id: "hook.event" });

  const task = defineTask({
    id: "task",
    run: async () => "Task executed",
  });

  defineHook({
    id: "test.resource",
    dependencies: { task },
    on: hookEvent,
    run: async (event, deps) => {
      event.data.message;
      // @ts-expect-error
      event.data.messagex;
      deps.task();
      // @ts-expect-error
      deps.task2;
    },
  });

  defineHook({
    id: "test.resource",
    dependencies: { task },
    on: "*",
    run: async (event, deps) => {
      event.data.message;
      event.data.messagex;
      deps.task();
      // @ts-expect-error
      deps.task2;
    },
  });
}

// Scenario: multi-event hooks should expose only common payload fields.
{
  const e1 = defineEvent<{ a: string; b: number; common: number }>({
    id: "e1",
  });
  const e2 = defineEvent<{ a: string; c: boolean; common: number }>({
    id: "e2",
  });
  const e3 = defineEvent<{
    a: string;
    b: number;
    d?: string;
    common: number;
  }>({ id: "e3" });

  defineHook({
    id: "hook.common",
    on: [e1, e2, e3],
    run: async (event) => {
      event.data.a;
      event.data.common;
      // @ts-expect-error b is not common to all
      event.data.b;
      // @ts-expect-error c is not common to all
      event.data.c;
    },
  });

  defineHook({
    id: "hook.helper",
    on: onAnyOf(e1, e3),
    run: async (event) => {
      event.data.a;
      event.data.common;
      // @ts-expect-error c is not common to all
      event.data.c;
      // @ts-expect-error d is not common to all
      event.data.d;
    },
  });

  defineHook({
    id: "hook.guard",
    on: [e1, e2],
    run: async (event) => {
      if (isOneOf(event, [e2, e1])) {
        event.data.a;
        event.data.common;
        // @ts-expect-error c not present in either
        event.data.c;
        // @ts-expect-error b not common
        event.data.b;
      }
    },
  });
}
