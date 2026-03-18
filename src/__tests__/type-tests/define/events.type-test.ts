import {
  defineEvent,
  defineHook,
  defineResource,
  defineTag,
  defineTask,
} from "../../../define";
import type { IEvent } from "../../../defs";
import { isOneOf, onAnyOf } from "../../../types/event";
import type { HookRevertFn } from "../../../types/hook";
import { subtreeOf } from "../../../";

// Type-only tests for define event and hook typing.

// Scenario: hooks should enforce event payload and dependency access.
{
  const hookEvent = defineEvent<{ message: string }>({ id: "hook-event" });

  const task = defineTask({
    id: "task",
    run: async () => "Task executed",
  });

  defineHook({
    id: "test-resource",
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
    id: "test-resource",
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

// Scenario: selector-based hook targets widen payload typing and keep "*" standalone.
{
  const selectorTag = defineTag({
    id: "define-selector-tag",
  });
  const subtreeEvent = defineEvent<{ subtree: string }>({
    id: "define-selector-subtree-event",
    transactional: true,
  });
  const exactEvent = defineEvent<{ exact: string }>({
    id: "define-selector-exact-event",
  });
  const ownerResource = defineResource({
    id: "define-selector-owner",
    register: [subtreeEvent],
  });
  const mixedTransactionalSelectorOn = [
    subtreeEvent,
    (event: IEvent<any>) => event.id === subtreeEvent.id,
  ] as const;

  defineHook({
    id: "define-selector-subtree-hook",
    on: subtreeOf(ownerResource),
    run: async (event) => {
      event.data.anythingGoes;
    },
  });

  defineHook({
    id: "define-selector-predicate-hook",
    on: (event: IEvent<any>) => selectorTag.exists(event),
    run: async (event) => {
      event.data.anythingGoes;
    },
  });

  defineHook({
    id: "define-selector-mixed-hook",
    on: [exactEvent, subtreeOf(ownerResource)],
    run: async () => {},
  });

  defineHook({
    id: "define-selector-mixed-payload-hook",
    on: [exactEvent, (event: IEvent<any>) => selectorTag.exists(event)],
    run: async (event) => {
      event.data.anythingGoes;
    },
  });

  defineHook({
    id: "define-selector-tx-runtime-only",
    on: subtreeOf(ownerResource),
    run: async () => {},
  });

  defineHook({
    id: "define-selector-tx-mixed-runtime-only",
    on: mixedTransactionalSelectorOn,
    run: async () => async () => {},
  });

  defineHook({
    id: "define-selector-event-subtree-explicit",
    on: subtreeOf(ownerResource, { types: ["event"] }),
    run: async () => {},
  });

  defineHook({
    id: "define-selector-invalid-wildcard-array",
    // @ts-expect-error wildcard must stay standalone
    on: [exactEvent, "*"] as const,
    run: async () => {},
  });
}

// Scenario: defineEvent transactional flag propagates to hook run typing where known.
{
  const txEvent = defineEvent({
    id: "define-tx-event",
    payloadSchema: { parse: (value: unknown) => value as { id: string } },
    transactional: true,
  });
  const nonTxEvent = defineEvent({
    id: "define-non-tx-event",
    payloadSchema: { parse: (value: unknown) => value as { id: string } },
  });

  defineHook({
    id: "define-tx-hook-ok",
    on: txEvent,
    run: async () => {
      const revert: HookRevertFn = async () => {};
      return revert;
    },
  });

  defineHook({
    id: "define-tx-hook-non-tx",
    on: nonTxEvent,
    run: async () => {},
  });

  defineHook({
    id: "define-tx-hook-mixed-ok",
    on: [txEvent, nonTxEvent] as const,
    run: async () => async () => {},
  });

  defineHook({
    id: "define-tx-hook-wildcard-runtime",
    on: "*",
    run: async () => {},
  });

  defineHook({
    id: "define-tx-hook-fail",
    on: txEvent,
    // @ts-expect-error transactional hooks must return undo closure
    run: async () => {},
  });

  defineHook({
    id: "define-tx-hook-mixed-fail",
    on: [txEvent, nonTxEvent] as const,
    // @ts-expect-error mixed subscriptions including transactional events must return undo closure
    run: async () => {},
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
    id: "hook-common",
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
    id: "hook-helper",
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
    id: "hook-guard",
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
