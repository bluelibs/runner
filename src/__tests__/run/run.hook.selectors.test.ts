import { subtreeOf } from "../..";
import type { IEvent } from "../../defs";
import {
  defineEvent,
  defineHook,
  defineResource,
  defineTag,
} from "../../define";

import { run } from "../../run";

describe("run hook selectors", () => {
  it("subtree selectors listen only to visible events from the subtree, including nested exports", async () => {
    const visibleEvent = defineEvent<{ id: string }>({
      id: "run-hook-selector-visible",
    });
    const hiddenEvent = defineEvent<{ id: string }>({
      id: "run-hook-selector-hidden",
    });
    const nestedVisibleEvent = defineEvent<{ id: string }>({
      id: "run-hook-selector-nested-visible",
    });

    const nested = defineResource({
      id: "run-hook-selector-nested",
      register: [nestedVisibleEvent],
      isolate: { exports: [nestedVisibleEvent] },
    });

    const owner = defineResource({
      id: "run-hook-selector-owner",
      register: [visibleEvent, hiddenEvent, nested],
      isolate: { exports: [visibleEvent, nested] },
    });

    const seen: string[] = [];
    const hook = defineHook({
      id: "run-hook-selector-subtree-hook",
      on: subtreeOf(owner),
      run: async (event) => {
        seen.push(event.id);
      },
    });

    const root = defineResource({
      id: "run-hook-selector-root",
      register: [owner, hook],
    });

    const runtime = await run(root);
    const visibleEventId = runtime.store.findIdByDefinition(visibleEvent);
    const hiddenEventId = runtime.store.findIdByDefinition(hiddenEvent);
    const nestedVisibleEventId =
      runtime.store.findIdByDefinition(nestedVisibleEvent);

    await runtime.emitEvent(visibleEvent, { id: "visible" });
    await runtime.emitEvent(hiddenEvent, { id: "hidden" });
    await runtime.emitEvent(nestedVisibleEvent, { id: "nested" });

    expect(seen).toEqual([visibleEventId, nestedVisibleEventId]);
    expect(seen).not.toContain(hiddenEventId);

    await runtime.dispose();
  });

  it("predicate selectors match visible registered events and filter inaccessible ones", async () => {
    const selectorTag = defineTag({
      id: "run-hook-selector-tag",
    });

    const publicTaggedEvent = defineEvent<{ id: string }>({
      id: "run-hook-selector-public-tagged",
      tags: [selectorTag],
    });
    const privateTaggedEvent = defineEvent<{ id: string }>({
      id: "run-hook-selector-private-tagged",
      tags: [selectorTag],
    });

    const owner = defineResource({
      id: "run-hook-selector-tag-owner",
      register: [selectorTag, publicTaggedEvent, privateTaggedEvent],
      isolate: { exports: [selectorTag, publicTaggedEvent] },
    });

    const seen: string[] = [];
    const hook = defineHook({
      id: "run-hook-selector-predicate-hook",
      on: (event: IEvent<any>) => selectorTag.exists(event),
      run: async (event) => {
        seen.push(event.id);
      },
    });

    const root = defineResource({
      id: "run-hook-selector-predicate-root",
      register: [owner, hook],
    });

    const runtime = await run(root);
    const publicTaggedEventId =
      runtime.store.findIdByDefinition(publicTaggedEvent);
    const privateTaggedEventId =
      runtime.store.findIdByDefinition(privateTaggedEvent);

    await runtime.emitEvent(publicTaggedEvent, { id: "public" });
    await runtime.emitEvent(privateTaggedEvent, { id: "private" });

    expect(seen).toEqual([publicTaggedEventId]);
    expect(seen).not.toContain(privateTaggedEventId);

    await runtime.dispose();
  });

  it("dedupes mixed exact and selector targets", async () => {
    const sharedEvent = defineEvent<void>({
      id: "run-hook-selector-shared-event",
    });

    const owner = defineResource({
      id: "run-hook-selector-dedupe-owner",
      register: [sharedEvent],
      isolate: { exports: [sharedEvent] },
    });

    const seen: string[] = [];
    const hook = defineHook({
      id: "run-hook-selector-dedupe-hook",
      on: [sharedEvent, subtreeOf(owner)],
      run: async (event) => {
        seen.push(event.id);
      },
    });

    const root = defineResource({
      id: "run-hook-selector-dedupe-root",
      register: [owner, hook],
    });

    const runtime = await run(root);
    await runtime.emitEvent(sharedEvent, undefined);

    expect(seen).toHaveLength(1);

    await runtime.dispose();
  });

  it("fails fast when mixed targets contain an unregistered exact event", async () => {
    const registeredEvent = defineEvent<void>({
      id: "run-hook-selector-registered-event",
    });
    const missingEvent = defineEvent<void>({
      id: "run-hook-selector-missing-event",
    });

    const owner = defineResource({
      id: "run-hook-selector-missing-owner",
      register: [registeredEvent],
      isolate: { exports: [registeredEvent] },
    });

    const hook = defineHook({
      id: "run-hook-selector-missing-hook",
      on: [subtreeOf(owner), missingEvent],
      run: async () => {},
    });

    const root = defineResource({
      id: "run-hook-selector-missing-root",
      register: [owner, hook],
    });

    await expect(run(root)).rejects.toThrow(missingEvent.id);
  });

  it("fails fast for subtree selectors with non-event types", async () => {
    const owner = defineResource({
      id: "run-hook-selector-invalid-types-owner",
    });

    const hook = defineHook({
      id: "run-hook-selector-invalid-types-hook",
      on: subtreeOf(owner, { types: ["task"] }),
      run: async () => {},
    });

    const root = defineResource({
      id: "run-hook-selector-invalid-types-root",
      register: [owner, hook],
    });

    await expect(run(root)).rejects.toThrow(
      /subtreeOf\(\) used in hook\.on\(\)/i,
    );
  });

  it("includes selector-based hooks in event emission cycle detection", async () => {
    const eventA = defineEvent<void>({
      id: "run-hook-selector-cycle-a",
    });
    const eventB = defineEvent<void>({
      id: "run-hook-selector-cycle-b",
    });

    const owner = defineResource({
      id: "run-hook-selector-cycle-owner",
      register: [eventA],
      isolate: { exports: [eventA] },
    });

    const onSubtree = defineHook({
      id: "run-hook-selector-cycle-on-subtree",
      on: subtreeOf(owner),
      dependencies: { eventB },
      run: async () => {},
    });

    const onEventB = defineHook({
      id: "run-hook-selector-cycle-on-b",
      on: eventB,
      dependencies: { eventA },
      run: async () => {},
    });

    const root = defineResource({
      id: "run-hook-selector-cycle-root",
      register: [owner, eventB, onSubtree, onEventB],
    });

    await expect(run(root)).rejects.toMatchObject({
      id: "eventEmissionCycle",
    });
  });
});
