import { globals } from "../../index";
import { runtimeSource } from "../../types/runtimeSource";
import { eventLaneEventNotRegisteredError } from "../../errors";
import type { EventManager } from "../../models/EventManager";
import type { Logger } from "../../models/Logger";
import type { Store } from "../../models/Store";
import type { Serializer } from "../../serializer";
import type { EventLaneMessage, EventLanesResourceConfig } from "./types";
import { resolveRemoteLanesMode } from "../remote-lanes/mode";
import { collectEventTopologyLanes } from "../remote-lanes/topologyLanes";
import { resolveEventLaneAssignments } from "./EventLaneAssignments";
import { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import { LocalSimulatedEventLaneTransport } from "./LocalSimulatedEventLaneTransport";
import {
  buildEventLanesContext,
  EventLanesLifecycleContext,
  EventLanesResourceContext,
  getLaneBindingOrThrow,
  isRelayEmission,
  normalizeErrorMessage,
  resolveEventLaneBindings,
} from "./EventLanesInternals";

export type EventLanesCoreDependencies = Record<string, unknown> & {
  eventManager: EventManager;
  serializer: Serializer;
  store: Store;
  logger: Logger;
};

type EventLanesInitializationResult = {
  profile: string;
  consumers: number;
};

export class EventLanesController {
  constructor(
    private readonly config: EventLanesResourceConfig,
    private readonly dependencies: EventLanesCoreDependencies,
    private readonly context: EventLanesResourceContext,
    private readonly diagnostics: EventLanesDiagnostics,
  ) {}

  public async init(): Promise<EventLanesInitializationResult> {
    const mode = resolveRemoteLanesMode(this.config.mode);
    const topologyLanes = collectEventTopologyLanes(this.config.topology);
    const eventRouteByEventId = resolveEventLaneAssignments(
      this.dependencies.store,
      topologyLanes,
    );

    if (mode === "network") {
      const resolved = resolveEventLaneBindings(this.config, this.dependencies);
      Object.assign(
        this.context,
        buildEventLanesContext(
          this.config,
          resolved.bindings,
          resolved.managedQueues,
          eventRouteByEventId,
        ),
      );

      for (const queue of this.context.managedQueues) {
        await queue.init?.();
      }

      this.registerProducerInterceptor();
      this.registerConsumersOnReady();
    } else {
      Object.assign(
        this.context,
        buildEventLanesContext(this.config, [], new Set(), eventRouteByEventId),
      );
    }

    if (mode === "local-simulated") {
      const localSimulatedTransport = new LocalSimulatedEventLaneTransport(
        this.dependencies,
        this.context,
        this.diagnostics,
      );
      localSimulatedTransport.register();
    }

    return {
      profile: this.config.profile,
      consumers: Array.from(this.context.activeBindingsByQueue.values()).reduce(
        (count, laneIds) => count + laneIds.size,
        0,
      ),
    };
  }

  public async cooldown(): Promise<void> {
    await EventLanesController.cooldownContext(this.context);
  }

  public async dispose(): Promise<void> {
    await EventLanesController.disposeContext(this.context);
  }

  public static async cooldownContext(
    context: EventLanesLifecycleContext,
  ): Promise<void> {
    if (context.coolingDown) {
      return;
    }

    context.coolingDown = true;
    for (const queue of context.activeBindingsByQueue.keys()) {
      await queue.cooldown?.();
    }
  }

  public static async disposeContext(
    context: EventLanesLifecycleContext,
  ): Promise<void> {
    context.coolingDown = true;
    context.disposed = true;
    for (const queue of context.managedQueues ?? new Set()) {
      await queue.dispose?.();
    }
  }

  private registerProducerInterceptor() {
    this.dependencies.eventManager.intercept(async (next, emission) => {
      if (isRelayEmission(emission, this.context.relaySourcePrefix)) {
        return next(emission);
      }

      const eventRoute = this.context.eventRouteByEventId.get(emission.id);
      if (!eventRoute) {
        return next(emission);
      }

      const binding = getLaneBindingOrThrow(
        eventRoute.lane.id,
        this.context.bindingsByLaneId,
      );
      emission.stopPropagation();

      await binding.queue.enqueue({
        laneId: eventRoute.lane.id,
        eventId: emission.id,
        payload: this.dependencies.serializer.stringify(emission.data),
        source: emission.source,
        orderingKey: eventRoute.orderingKey,
        metadata: eventRoute.metadata,
        maxAttempts: 1,
      });
      await this.diagnostics.logEnqueue({
        eventId: emission.id,
        laneId: eventRoute.lane.id,
        profile: this.context.profile,
        mode: resolveRemoteLanesMode(this.config.mode),
        sourceKind: emission.source.kind,
        sourceId: emission.source.id,
        orderingKey: eventRoute.orderingKey,
      });
    });
  }

  private registerConsumersOnReady() {
    this.dependencies.eventManager.addListener(
      globals.events.ready,
      async () => {
        if (this.context.started || this.context.disposed) {
          return;
        }
        this.context.started = true;

        await this.applyPrefetchPolicies();
        for (const [queue, activeLaneIds] of this.context
          .activeBindingsByQueue) {
          await queue.consume(async (message) => {
            await this.consumeQueueMessage(queue, activeLaneIds, message);
          });
        }
      },
      { id: `${this.context.profile}.event-lanes.ready` },
    );
  }

  private async applyPrefetchPolicies(): Promise<void> {
    for (const [queue, laneIds] of this.context.activeBindingsByQueue) {
      let resolvedPrefetch: number | undefined;
      for (const laneId of laneIds) {
        const binding = this.context.bindingsByLaneId.get(laneId)!;
        const candidatePrefetch = binding.prefetch;
        if (candidatePrefetch === undefined || candidatePrefetch < 1) {
          continue;
        }
        resolvedPrefetch = Math.max(resolvedPrefetch ?? 0, candidatePrefetch);
      }

      if (resolvedPrefetch !== undefined) {
        await queue.setPrefetch?.(resolvedPrefetch);
      }
    }
  }

  private async consumeQueueMessage(
    queue: {
      nack(id: string, requeue?: boolean): Promise<void>;
      ack(id: string): Promise<void>;
    },
    activeLaneIds: Set<string>,
    message: EventLaneMessage,
  ): Promise<void> {
    if (this.context.coolingDown || this.context.disposed) {
      await queue.nack(message.id, true);
      return;
    }

    if (!activeLaneIds.has(message.laneId)) {
      await this.diagnostics.logSkipInactiveLane({
        messageId: message.id,
        eventId: message.eventId,
        laneId: message.laneId,
        profile: this.context.profile,
        activeLaneIds: Array.from(activeLaneIds),
      });
      await queue.nack(message.id, true);
      return;
    }

    const binding = this.context.bindingsByLaneId.get(message.laneId)!;

    try {
      const eventStoreEntry = this.dependencies.store.events.get(
        message.eventId,
      );
      if (!eventStoreEntry) {
        eventLaneEventNotRegisteredError.throw({ eventId: message.eventId });
      }

      const payload = this.dependencies.serializer.parse(message.payload);
      const relaySourceId = `${this.context.relaySourcePrefix}${this.context.profile}:${message.laneId}`;
      await this.diagnostics.logRelayEmit({
        messageId: message.id,
        eventId: message.eventId,
        laneId: message.laneId,
        profile: this.context.profile,
        relaySourceId,
      });
      await this.dependencies.eventManager.emit(
        eventStoreEntry!.event,
        payload,
        runtimeSource.runtime(relaySourceId),
      );
      await queue.ack(message.id);
    } catch (error) {
      if (binding.dlq?.queue) {
        await binding.dlq.queue.enqueue({
          laneId: message.laneId,
          eventId: message.eventId,
          payload: message.payload,
          source: message.source,
          orderingKey: message.orderingKey,
          maxAttempts: 1,
          metadata: {
            ...(message.metadata || {}),
            eventLaneDlq: {
              failedAt: new Date().toISOString(),
              reason: normalizeErrorMessage(error),
            },
          },
        });
      }

      await queue.nack(message.id, false);
      await this.dependencies.logger.error("Event lane consumer failed.", {
        laneId: message.laneId,
        eventId: message.eventId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
