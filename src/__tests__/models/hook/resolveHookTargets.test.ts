import { subtreeOf } from "../../..";
import { defineEvent, defineResource } from "../../../define";
import { resolveHookTargets } from "../../../models/hook/resolveHookTargets";
import type { AccessViolation } from "../../../models/visibility-tracker/contracts";

describe("resolveHookTargets", () => {
  it("rejects wildcard entries inside mixed arrays", () => {
    const event = defineEvent({ id: "hook-resolve-wildcard-event" });

    expect(() =>
      resolveHookTargets({
        context: createContext({ events: [event] }),
        hookId: "hook-resolve-wildcard-hook",
        on: [event, "*" as never],
      }),
    ).toThrow(/Wildcard "\*" must be used as a standalone hook target/i);
  });

  it("accepts subtreeOf(resource, { types: ['event'] }) and resolves subtree events", () => {
    const resource = defineResource({
      id: "hook-resolve-valid-subtree-resource",
    });
    const event = defineEvent({ id: "hook-resolve-valid-subtree-event" });

    const matches = resolveHookTargets({
      context: createContext({
        events: [event],
        resources: [resource],
        subtreeMembership: {
          [resource.id]: new Set([event.id]),
        },
      }),
      hookId: "hook-resolve-valid-subtree-hook",
      on: subtreeOf(resource, { types: ["event"] }),
    });

    expect(matches).toEqual([{ event, provenance: "selector" }]);
  });

  it("fails fast when an exact target cannot be resolved to an event id", () => {
    expect(() =>
      resolveHookTargets({
        context: createContext(),
        hookId: "hook-resolve-unresolvable-hook",
        on: 123 as never,
      }),
    ).toThrow(/Event "123" not found/i);
  });

  it("fails fast when an exact target resolves to an event id missing from the registry", () => {
    const missingEvent = defineEvent({ id: "hook-resolve-missing-event" });

    expect(() =>
      resolveHookTargets({
        context: createContext(),
        hookId: "hook-resolve-missing-hook",
        on: missingEvent,
      }),
    ).toThrow(/Event "hook-resolve-missing-event" not found/i);
  });

  it("falls back to the target object's id when alias resolution misses for exact events", () => {
    const event = defineEvent({ id: "hook-resolve-object-fallback-event" });
    const context = createContext({
      events: [event],
      resolveDefinitionId(reference) {
        return typeof reference === "string" ? reference : undefined;
      },
    });

    const matches = resolveHookTargets({
      context,
      hookId: "hook-resolve-object-fallback-hook",
      on: event,
    });

    expect(matches).toEqual([{ event, provenance: "exact" }]);
  });

  it("fails fast when subtreeOf() references an unknown resource", () => {
    const missingResource = defineResource({
      id: "hook-resolve-missing-resource",
    });

    expect(() =>
      resolveHookTargets({
        context: createContext(),
        hookId: "hook-resolve-missing-resource-hook",
        on: subtreeOf(missingResource),
      }),
    ).toThrow(/Resource "hook-resolve-missing-resource" not found/i);
  });

  it("falls back to subtree filter ids when resource alias resolution is unavailable", () => {
    const resource = defineResource({
      id: "hook-resolve-subtree-id-fallback-resource",
    });
    const event = defineEvent({ id: "hook-resolve-subtree-id-fallback-event" });
    const context = createContext({
      events: [event],
      resources: [resource],
      subtreeMembership: {
        [resource.id]: new Set([event.id]),
      },
      resolveDefinitionId(reference) {
        return typeof reference === "string" ? undefined : undefined;
      },
    });

    const matches = resolveHookTargets({
      context,
      hookId: "hook-resolve-subtree-id-fallback-hook",
      on: subtreeOf(resource),
    });

    expect(matches).toEqual([{ event, provenance: "selector" }]);
  });

  it("resolves raw subtree filters that do not carry an object resource reference", () => {
    const resource = defineResource({
      id: "hook-resolve-raw-subtree-resource",
    });
    const event = defineEvent({ id: "hook-resolve-raw-subtree-event" });

    const matches = resolveHookTargets({
      context: createContext({
        events: [event],
        resources: [resource],
        subtreeMembership: {
          [resource.id]: new Set([event.id]),
        },
      }),
      hookId: "hook-resolve-raw-subtree-hook",
      on: {
        _subtreeFilter: true,
        resourceId: resource.id,
        types: ["event"],
      } as never,
    });

    expect(matches).toEqual([{ event, provenance: "selector" }]);
  });

  it("does not invoke predicate selectors for inaccessible events", () => {
    const accessibleEvent = defineEvent({
      id: "hook-resolve-accessible-predicate-event",
    });
    const inaccessibleEvent = defineEvent({
      id: "hook-resolve-inaccessible-predicate-event",
    });
    const predicate = jest.fn((event: { id: string }) => {
      if (event.id === inaccessibleEvent.id) {
        throw new Error("predicate should not receive inaccessible events");
      }

      return event.id === accessibleEvent.id;
    });

    const matches = resolveHookTargets({
      context: createContext({
        events: [accessibleEvent, inaccessibleEvent],
        inaccessibleEventIds: [inaccessibleEvent.id],
      }),
      hookId: "hook-resolve-predicate-visibility-hook",
      on: predicate,
    });

    expect(matches).toEqual([
      { event: accessibleEvent, provenance: "selector" },
    ]);
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalledWith(accessibleEvent);
  });
});

function createContext(options?: {
  events?: Array<ReturnType<typeof defineEvent>>;
  resources?: Array<{ id: string }>;
  inaccessibleEventIds?: string[];
  subtreeMembership?: Record<string, Set<string>>;
  resolveDefinitionId?: (reference: unknown) => string | undefined;
}) {
  const events = new Map(
    (options?.events ?? []).map((event) => [event.id, event] as const),
  );
  const resources = new Map(
    (options?.resources ?? []).map(
      (resource) => [resource.id, resource] as const,
    ),
  );
  const inaccessibleEventIds = new Set(options?.inaccessibleEventIds ?? []);
  const subtreeMembership = options?.subtreeMembership ?? {};

  return {
    resolveDefinitionId(reference: unknown): string | undefined {
      if (options?.resolveDefinitionId) {
        return options.resolveDefinitionId(reference);
      }

      if (typeof reference === "string") {
        return reference;
      }
      if (reference && typeof reference === "object" && "id" in reference) {
        const id = (reference as { id?: unknown }).id;
        return typeof id === "string" ? id : undefined;
      }

      return undefined;
    },
    getEventById(id: string) {
      return events.get(id);
    },
    getRegisteredEvents() {
      return events.values();
    },
    getResourceById(id: string) {
      return resources.get(id);
    },
    isWithinResourceSubtree(resourceId: string, itemId: string) {
      return subtreeMembership[resourceId]?.has(itemId) ?? false;
    },
    getAccessViolation(targetId: string) {
      return inaccessibleEventIds.has(targetId)
        ? ({
            kind: "isolate",
            policyResourceId: "hook-resolve-policy",
            matchedRuleType: "id",
            matchedRuleId: "hook-resolve-rule",
            channel: "listening",
          } satisfies AccessViolation)
        : null;
    },
  };
}
