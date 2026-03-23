import { events } from "../../index";
import { runtimeSource } from "../../types/runtimeSource";
import {
  eventLaneAssignmentMismatchError,
  eventLaneEventNotRegisteredError,
  eventLanePayloadMalformedError,
} from "../../errors";
import type { EventManager } from "../../models/EventManager";
import type { Logger } from "../../models/Logger";
import type { Store } from "../../models/Store";
import type { SerializerLike } from "../../serializer";
import { handleEventLaneConsumerFailure } from "./EventLanesFailureHandler";
import type { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import type { EventLanesResourceContext } from "./EventLanesInternals";
import type { EventLaneMessage, EventLanesResourceConfig } from "./types";
import {
  applyPrefetchPolicies,
  type QueueLikeWithAck,
} from "./eventLanes.routing";
import {
  resolveEventLaneBindingAuth,
  verifyEventLaneMessageToken,
} from "./eventLanes.auth";
import { withEventLaneAsyncContexts } from "./eventLanes.asyncContext";

const defaultConsumerDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type ConsumerDeps = {
  eventManager: EventManager;
  store: Store;
  serializer: SerializerLike;
  logger: Logger;
};

export function registerEventLaneConsumersOnReady(options: {
  dependencies: ConsumerDeps;
  context: EventLanesResourceContext;
  consumeQueueMessage: (
    queue: QueueLikeWithAck,
    activeLaneIds: Set<string>,
    message: EventLaneMessage,
  ) => Promise<void>;
}): void {
  const { dependencies, context, consumeQueueMessage } = options;
  const readyEventId = dependencies.store.findIdByDefinition(events.ready);
  const readyEvent = dependencies.store.findDefinitionById(
    readyEventId,
  ) as typeof events.ready;

  dependencies.eventManager.addListener(
    readyEvent,
    async () => {
      if (context.started || context.disposed) {
        return;
      }
      context.started = true;

      await applyPrefetchPolicies(context);
      for (const [queue, activeLaneIds] of context.activeBindingsByQueue) {
        await queue.consume(async (message) => {
          await consumeQueueMessage(queue, activeLaneIds, message);
        });
      }
    },
    { id: `${context.profile}.event-lanes.ready` },
  );
}

export async function consumeEventLaneQueueMessage(options: {
  config: EventLanesResourceConfig;
  dependencies: ConsumerDeps;
  context: EventLanesResourceContext;
  diagnostics: EventLanesDiagnostics;
  queue: QueueLikeWithAck;
  activeLaneIds: Set<string>;
  message: EventLaneMessage;
  delay?: (ms: number) => Promise<void>;
}): Promise<void> {
  const {
    config,
    dependencies,
    context,
    diagnostics,
    queue,
    activeLaneIds,
    message,
    delay = defaultConsumerDelay,
  } = options;

  if (context.coolingDown || context.disposed) {
    await queue.nack(message.id, true);
    return;
  }

  if (!activeLaneIds.has(message.laneId)) {
    await diagnostics.logSkipInactiveLane({
      messageId: message.id,
      eventId: message.eventId,
      laneId: message.laneId,
      profile: context.profile,
      activeLaneIds: Array.from(activeLaneIds),
    });
    await queue.nack(message.id, true);
    return;
  }

  const binding = context.bindingsByLaneId.get(message.laneId)!;

  try {
    verifyEventLaneMessageToken({
      message,
      laneId: binding.lane.id,
      bindingAuth: resolveEventLaneBindingAuth({
        laneId: binding.lane.id,
        context,
        config,
      }),
      replayProtector: context.replayProtector,
    });
    const resolvedMessageEventId =
      dependencies.store.events.get(message.eventId)?.event.id ??
      message.eventId;
    const eventStoreEntry = dependencies.store.events.get(
      resolvedMessageEventId,
    );
    if (!eventStoreEntry) {
      eventLaneEventNotRegisteredError.throw({ eventId: message.eventId });
    }
    const assignedRoute = context.eventRouteByEventId.get(
      resolvedMessageEventId,
    );
    if (!assignedRoute || assignedRoute.lane.id !== message.laneId) {
      eventLaneAssignmentMismatchError.throw({
        eventId: resolvedMessageEventId,
        laneId: message.laneId,
      });
    }

    const payload = parseEventLanePayload(
      message.laneId,
      resolvedMessageEventId,
      message.payload,
      dependencies.serializer,
    );
    const relaySourceId = `${context.relaySourcePrefix}${context.profile}:${message.laneId}`;
    await diagnostics.logRelayEmit({
      messageId: message.id,
      eventId: message.eventId,
      laneId: message.laneId,
      profile: context.profile,
      relaySourceId,
    });
    await withEventLaneAsyncContexts({
      lane: binding.lane,
      serializedAsyncContexts: message.serializedAsyncContexts,
      store: dependencies.store,
      serializer: dependencies.serializer,
      fn: async () =>
        await dependencies.eventManager.emit(
          eventStoreEntry!.event,
          payload,
          runtimeSource.runtime(relaySourceId),
        ),
    });
    await queue.ack(message.id);
  } catch (error) {
    await handleEventLaneConsumerFailure({
      queue,
      binding,
      message,
      error,
      logger: dependencies.logger,
      delay,
    });
  }
}

function parseEventLanePayload(
  laneId: string,
  eventId: string,
  rawPayload: string,
  serializer: SerializerLike,
): unknown {
  try {
    return serializer.parse(rawPayload);
  } catch (error) {
    eventLanePayloadMalformedError.throw({
      laneId,
      eventId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
