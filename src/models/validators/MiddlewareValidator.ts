import { middlewareNotRegisteredError } from "../../errors";
import { getStoredSubtreePolicy } from "../../definers/subtreePolicy";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
  resolveApplicableSubtreeTaskMiddlewares,
} from "../../tools/subtreeMiddleware";
import type { ValidatorContext } from "./ValidatorContext";

/**
 * Validates that all middleware attachments reference registered middleware.
 */
export function validateMiddlewareRegistrations(ctx: ValidatorContext): void {
  validateTaskMiddlewareAttachments(ctx);
  validateResourceMiddlewareAttachments(ctx);
  validateSubtreeMiddlewareAttachments(ctx);
  validateSubtreeTaskMiddlewareComposition(ctx);
}

function validateTaskMiddlewareAttachments(ctx: ValidatorContext): void {
  for (const { task } of ctx.registry.tasks.values()) {
    for (const middlewareAttachment of task.middleware) {
      const middlewareId = ctx.resolveReferenceId(middlewareAttachment);
      if (!middlewareId || !ctx.registry.taskMiddlewares.has(middlewareId)) {
        middlewareNotRegisteredError.throw({
          type: "task",
          source: ctx.findIdByDefinition(task),
          middlewareId: ctx.findIdByDefinition(middlewareAttachment),
        });
      }
    }
  }
}

function validateResourceMiddlewareAttachments(ctx: ValidatorContext): void {
  for (const { resource } of ctx.registry.resources.values()) {
    for (const middlewareAttachment of resource.middleware) {
      const middlewareId = ctx.resolveReferenceId(middlewareAttachment);
      if (
        !middlewareId ||
        !ctx.registry.resourceMiddlewares.has(middlewareId)
      ) {
        middlewareNotRegisteredError.throw({
          type: "resource",
          source: ctx.findIdByDefinition(resource),
          middlewareId: ctx.findIdByDefinition(middlewareAttachment),
        });
      }
    }
  }
}

function validateSubtreeMiddlewareAttachments(ctx: ValidatorContext): void {
  for (const { resource: ownerResource } of ctx.registry.resources.values()) {
    const subtreePolicy = getStoredSubtreePolicy(ownerResource);
    if (!subtreePolicy) {
      continue;
    }

    for (const middlewareEntry of subtreePolicy.tasks?.middleware ?? []) {
      const middleware = getSubtreeTaskMiddlewareAttachment(middlewareEntry);
      const middlewareId = ctx.resolveReferenceId(middleware);
      if (!middlewareId || !ctx.registry.taskMiddlewares.has(middlewareId)) {
        middlewareNotRegisteredError.throw({
          type: "task",
          source: ctx.findIdByDefinition(ownerResource),
          middlewareId: ctx.findIdByDefinition(middleware),
        });
      }
    }

    for (const middlewareEntry of subtreePolicy.resources?.middleware ?? []) {
      const middleware =
        getSubtreeResourceMiddlewareAttachment(middlewareEntry);
      const middlewareId = ctx.resolveReferenceId(middleware);
      if (
        !middlewareId ||
        !ctx.registry.resourceMiddlewares.has(middlewareId)
      ) {
        middlewareNotRegisteredError.throw({
          type: "resource",
          source: ctx.findIdByDefinition(ownerResource),
          middlewareId: ctx.findIdByDefinition(middleware),
        });
      }
    }
  }
}

function validateSubtreeTaskMiddlewareComposition(ctx: ValidatorContext): void {
  const lookup = {
    getOwnerResourceId: (itemId: string) =>
      ctx.registry.visibilityTracker.getOwnerResourceId(itemId),
    getResource: (resourceId: string) =>
      ctx.registry.resources.get(resourceId)?.resource,
  };

  for (const { task } of ctx.registry.tasks.values()) {
    resolveApplicableSubtreeTaskMiddlewares(lookup, task);
  }
}
