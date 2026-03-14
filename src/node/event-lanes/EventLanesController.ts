import { events } from "../../index";
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
import { handleEventLaneConsumerFailure } from "./EventLanesFailureHandler";
import { LocalSimulatedEventLaneTransport } from "./LocalSimulatedEventLaneTransport";
import { issueRemoteLaneToken } from "../remote-lanes/laneAuth";
import {
  collectBindingAuthByLaneId,
  enforceEventLaneAuthReadiness,
  resolveEventLaneBindingAuth,
  verifyEventLaneMessageToken,
} from "./eventLanes.auth";
import {
  buildEventLanesContext,
  EventLanesLifecycleContext,
  EventLanesResourceContext,
  getLaneBindingOrThrow,
  isRelayEmission,
  resolveEventLaneBindings,
} from "./EventLanesInternals";
import {
  applyPrefetchPolicies,
  validateAssignedEventRoutesHaveBindings,
} from "./eventLanes.routing";
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
  private producerInterceptorRegistered = false;

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
      validateAssignedEventRoutesHaveBindings(this.context);

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

    enforceEventLaneAuthReadiness({
      mode,
      context: this.context,
      config: this.config,
    });

    if (mode === "local-simulated") {
      const localSimulatedTransport = new LocalSimulatedEventLaneTransport(
        this.dependencies,
        this.context,
        this.diagnostics,
        collectBindingAuthByLaneId(this.config),
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
    if (this.producerInterceptorRegistered) {
      return;
    }
    this.producerInterceptorRegistered = true;

    this.dependencies.eventManager.intercept(async (next, emission) => {
      if (this.context.disposed || this.context.coolingDown) {
        return next(emission);
      }

      if (isRelayEmission(emission, this.context.relaySourcePrefix)) {
        return next(emission);
      }

      const resolvedEmissionId = emission.id;
      const eventRoute =
        this.context.eventRouteByEventId.get(resolvedEmissionId);
      if (!eventRoute) {
        return next(emission);
      }

      const binding = getLaneBindingOrThrow(
        eventRoute.lane.id,
        this.context.bindingsByLaneId,
      );
      const bindingAuth = resolveEventLaneBindingAuth({
        laneId: eventRoute.lane.id,
        context: this.context,
        config: this.config,
      });
      const canonicalEventId = resolvedEmissionId;
      const authToken = issueRemoteLaneToken({
        laneId: eventRoute.lane.id,
        bindingAuth,
        capability: "produce",
      });

      await binding.queue.enqueue({
        laneId: eventRoute.lane.id,
        eventId: canonicalEventId,
        payload: this.dependencies.serializer.stringify(emission.data),
        source: emission.source,
        authToken,
        maxAttempts: binding.maxAttempts ?? 1,
      });
      emission.stopPropagation();
      await this.diagnostics.logEnqueue({
        eventId: canonicalEventId,
        laneId: eventRoute.lane.id,
        profile: this.context.profile,
        mode: resolveRemoteLanesMode(this.config.mode),
        sourceKind: emission.source.kind,
        sourceId: emission.source.id,
      });
    });
  }

  private registerConsumersOnReady() {
    const readyEventId = this.dependencies.store.findIdByDefinition(
      events.ready,
    );
    const readyEvent = this.dependencies.store.findDefinitionById(
      readyEventId,
    ) as typeof events.ready;

    this.dependencies.eventManager.addListener(
      readyEvent,
      async () => {
        if (this.context.started || this.context.disposed) {
          return;
        }
        this.context.started = true;

        await applyPrefetchPolicies(this.context);
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
      verifyEventLaneMessageToken({
        message,
        laneId: binding.lane.id,
        bindingAuth: resolveEventLaneBindingAuth({
          laneId: binding.lane.id,
          context: this.context,
          config: this.config,
        }),
      });
      const resolvedMessageEventId =
        this.dependencies.store.events.get(message.eventId)?.event.id ??
        message.eventId;
      const eventStoreEntry = this.dependencies.store.events.get(
        resolvedMessageEventId,
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
      await handleEventLaneConsumerFailure({
        queue,
        binding,
        message,
        error,
        logger: this.dependencies.logger,
        delay: (ms) => this.delay(ms),
      });
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
