import {
  transactionalParallelConflictError,
  transactionalEventLaneConflictError,
  eventLaneRpcLaneConflictError,
} from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { ValidatorContext } from "./ValidatorContext";

/**
 * Validates event constraints:
 * - Transactional events cannot be parallel
 * - Transactional events cannot have eventLane tag
 * - Events cannot have both eventLane and rpcLane tags
 */
export function validateEventConstraints(ctx: ValidatorContext): void {
  validateTransactionalEvents(ctx);
  validateEventLaneRpcLaneMutualExclusion(ctx);
}

function validateTransactionalEvents(ctx: ValidatorContext): void {
  for (const { event } of ctx.registry.events.values()) {
    if (!event.transactional) {
      continue;
    }

    if (event.parallel) {
      transactionalParallelConflictError.throw({
        eventId: event.id,
      });
    }

    const hasEventLaneTag = event.tags.some(
      (tag) => ctx.resolveReferenceId(tag) === globalTags.eventLane.id,
    );
    if (hasEventLaneTag) {
      transactionalEventLaneConflictError.throw({
        eventId: event.id,
        tagId: globalTags.eventLane.id,
      });
    }
  }
}

function validateEventLaneRpcLaneMutualExclusion(ctx: ValidatorContext): void {
  for (const { event } of ctx.registry.events.values()) {
    const hasEventLaneTag = event.tags.some(
      (tag) => ctx.resolveReferenceId(tag) === globalTags.eventLane.id,
    );
    if (!hasEventLaneTag) {
      continue;
    }

    const hasRpcLaneTag = event.tags.some(
      (tag) => ctx.resolveReferenceId(tag) === globalTags.rpcLane.id,
    );
    if (!hasRpcLaneTag) {
      continue;
    }

    eventLaneRpcLaneConflictError.throw({
      eventId: event.id,
      eventLaneTagId: globalTags.eventLane.id,
      rpcLaneTagId: globalTags.rpcLane.id,
    });
  }
}
