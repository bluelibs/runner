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
  collectBindingAuthByLaneId,
  enforceEventLaneAuthReadiness,
} from "./eventLanes.auth";
import {
  buildEventLanesContext,
  EventLanesLifecycleContext,
  EventLanesResourceContext,
  resolveEventLaneBindings,
} from "./EventLanesInternals";
import {
  validateAssignedEventRoutesHaveBindings,
  type QueueLikeWithAck,
} from "./eventLanes.routing";
import { registerEventLaneProducerInterceptor } from "./eventLanes.producer";
import {
  consumeEventLaneQueueMessage,
  registerEventLaneConsumersOnReady,
} from "./eventLanes.consumer";
import { registerEventLaneRelayInterceptors } from "./eventLanes.relayInterceptors";
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

    registerEventLaneRelayInterceptors({
      dependencies: this.dependencies,
      context: this.context,
    });

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

    registerEventLaneProducerInterceptor({
      config: this.config,
      dependencies: this.dependencies,
      context: this.context,
      diagnostics: this.diagnostics,
    });
  }

  private registerConsumersOnReady() {
    registerEventLaneConsumersOnReady({
      dependencies: this.dependencies,
      context: this.context,
      consumeQueueMessage: async (queue, activeLaneIds, message) => {
        await this.consumeQueueMessage(queue, activeLaneIds, message);
      },
    });
  }

  private async consumeQueueMessage(
    queue: QueueLikeWithAck,
    activeLaneIds: Set<string>,
    message: EventLaneMessage,
  ): Promise<void> {
    await consumeEventLaneQueueMessage({
      config: this.config,
      dependencies: this.dependencies,
      context: this.context,
      diagnostics: this.diagnostics,
      queue,
      activeLaneIds,
      message,
      delay: (ms) => this.delay(ms),
    });
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
