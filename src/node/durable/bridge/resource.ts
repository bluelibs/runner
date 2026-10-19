import { waitForEvent } from "./wait";
import { AsyncLocalStorage } from "node:async_hooks";
import { r, resources } from "../../../index";
import { defineTask } from "../../../definers/defineTask";
import type { Store } from "../../../models/store/Store";
import type { EventManager } from "../../../models/EventManager";
import type { Serializer } from "../../../serializer";
import type { IEventEmitReport } from "../../../types/event";
import { runnerDurableContext } from "../core/runnerContext";
import type { DurableResource } from "../core/DurableResource";
type DurableEventRuntime = Pick<DurableResource, keyof DurableResource>;
import type { IDurableStore } from "../core/interfaces/store";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";
import {
  bridgeError,
  eventPolicy,
  eventHooks,
  assertNoLaneRoute,
} from "./plan";
import { executeEvent } from "./execute";
import type { DurableEventBridgeConfig, DurableEventInput } from "./types";
import type { ITask } from "../../../types/task";
import { parseBridgeConfig } from "./validation";
import { retentionDelay } from "../core/retention";

const eventTask: ITask<
  DurableEventInput,
  Promise<IEventEmitReport>,
  any
> = defineTask({
  id: "dispatchDurableEvent",
  meta: {
    title: "Durable Event Dispatch",
    description: "Executes a persisted Runner event hook plan.",
  },
  dependencies: () => ({ bridge: durableEventBridgeResource }),
  run: async (
    input: DurableEventInput,
    { bridge }: { bridge: DurableEventBridge },
  ) => bridge.execute(input),
});

/** Per-run bridge state; no process-wide workflow or routing state. */
export class DurableEventBridge {
  private readonly hookScope = new AsyncLocalStorage<boolean>();
  private readonly routes = new Map<
    string,
    {
      id: string;
      durable: DurableEventRuntime;
      policy: NonNullable<ReturnType<typeof eventPolicy>>;
    }
  >();

  constructor(
    private readonly deps: {
      store: Store;
      eventManager: EventManager;
      serializer: Serializer;
    },
    runtimes: readonly {
      definition: { id: string };
      value: DurableEventRuntime | undefined;
    }[],
    config: DurableEventBridgeConfig,
    bridgeId: string,
  ) {
    retentionDelay(config.retention);
    for (const { event } of deps.store.events.values()) {
      const policy = eventPolicy(event, config);
      if (!policy) continue;
      assertNoLaneRoute(deps.store, event.id);
      const visible = runtimes.filter((entry) =>
        deps.store.isItemVisibleToConsumer(entry.definition.id, bridgeId),
      );
      const reference = policy.durable ?? config.defaultDurable;
      const target = reference
        ? visible.find(
            (entry) =>
              entry.definition.id === deps.store.findIdByDefinition(reference),
          )
        : visible.length === 1
          ? visible[0]
          : undefined;
      if (!target)
        bridgeError(
          `Durable event '${event.id}' needs one visible runtime or an explicit durable resource; candidates: ${visible.map((entry) => entry.definition.id).join(", ")}.`,
        );
      retentionDelay(policy.retention);
      eventHooks(
        deps.store,
        deps.eventManager,
        event,
        policy.compensation === "required",
      );
      this.routes.set(event.id, {
        id: target!.definition.id,
        // Tag startup dependencies can be discovered before their values are initialized.
        // Resolve the value only when dispatch is admitted after resource initialization.
        get durable(): DurableEventRuntime {
          const value: DurableEventRuntime | undefined =
            deps.store.resources.get(target!.definition.id)?.value;
          if (!value)
            bridgeError(
              `Durable runtime '${target!.definition.id}' is not initialized.`,
            );
          return value!;
        },
        policy,
      });
    }
    deps.eventManager.setDispatchAdapter(
      (definition, event, listeners, options) => {
        const route = this.routes.get(definition.id);
        if (!route) return undefined;
        if (
          options.failureMode === "aggregate" ||
          options.throwOnError === false
        )
          bridgeError(
            "Durable event emissions require fail-fast errors and throwOnError enabled.",
          );
        if (!deps.eventManager.isLocked)
          bridgeError(
            "Emit durable events after resource initialization, from ready hooks or tasks.",
          );
        return (async () => {
          if (this.hookScope.getStore())
            bridgeError(
              "Nested durable event emission from a hook step is not supported; emit from the workflow body.",
            );
          const hooks = eventHooks(
            deps.store,
            deps.eventManager,
            definition,
            route.policy.compensation === "required",
          );
          if (hooks.length !== listeners.length)
            bridgeError(
              `Durable event '${definition.id}' registrations changed.`,
            );
          const input: DurableEventInput = {
            eventId: definition.id,
            resourceId: route.id,
            hookIds: hooks.map((hook) => hook.id!),
            version: route.policy.version ?? "1",
            data: event.data,
            source: event.source,
            timestamp: event.timestamp,
            compensation: route.policy.compensation === "required",
          };
          // Round-trip before admission so invalid payloads fail before side effects.
          const persisted = deps.serializer.parse<DurableEventInput>(
            deps.serializer.stringify(input),
          );
          const parent = runnerDurableContext(deps.store).getStore();
          if (!parent)
            return (
              await waitForEvent(
                route.durable.startAndWait(eventTask, persisted, {
                  retention: route.policy.retention ?? config.retention,
                  idempotencyKey:
                    options.idempotencyKey === undefined
                      ? undefined
                      : JSON.stringify([definition.id, options.idempotencyKey]),
                }),
                event.signal,
              )
            ).data;
          const stepId = parent._eventStepId(definition.id, options.stepId);
          const childId = await parent.step(stepId, async () =>
            route.durable.start(eventTask, persisted, {
              parentExecutionId: parent.executionId,
              idempotencyKey:
                options.idempotencyKey === undefined
                  ? JSON.stringify([parent.executionId, stepId])
                  : JSON.stringify([definition.id, options.idempotencyKey]),
              retention: route.policy.retention ?? config.retention,
            }),
          );
          if (route.durable.current() === parent)
            return parent.waitForExecution(eventTask, childId);
          return waitForEvent(
            route.durable.wait<IEventEmitReport>(childId),
            event.signal,
          );
        })();
      },
    );
  }

  /** @internal Resumes the registered persisted event workflow. */
  async execute(input: DurableEventInput): Promise<IEventEmitReport> {
    const route = this.routes.get(input.eventId);
    if (
      !route ||
      route.id !== input.resourceId ||
      (route.policy.version ?? "1") !== input.version ||
      (route.policy.compensation === "required") !== input.compensation
    )
      bridgeError(
        `Durable event '${input.eventId}' route changed; restore its original backend.`,
      );
    const backend: IDurableStore = route!.durable.getStore();
    return executeEvent(input, {
      ...this.deps,
      manager: this.deps.eventManager,
      durable: route!.durable,
      backend,
      inHook: (fn) => this.hookScope.run(true, fn),
    });
  }
}

/** Bridges selected Runner emissions to the registered durable workflow engine. */
export const durableEventBridgeResource = r
  .resource<DurableEventBridgeConfig>("durableEventBridge")
  .meta({
    title: "Durable Event Bridge",
    description: "Routes selected event emissions through durable workflows.",
  })
  .configSchema({ parse: parseBridgeConfig })
  .register([eventTask])
  .dependencies({
    store: resources.store,
    eventManager: resources.eventManager,
    serializer: resources.serializer,
    runtimes: durableRuntimeTag.startup(),
  })
  .init(async function (
    this: { id: string },
    config,
    dependencies,
  ): Promise<DurableEventBridge> {
    return new DurableEventBridge(
      dependencies,
      dependencies.runtimes.resources,
      config,
      this.id,
    );
  })
  .build();
