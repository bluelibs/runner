import { middlewareNotRegisteredError } from "../../errors";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../../tools/subtreeMiddleware";
import type { ValidatorContext } from "./ValidatorContext";

/**
 * Validates that all middleware attachments reference registered middleware.
 */
export function validateMiddlewareRegistrations(ctx: ValidatorContext): void {
  validateTaskMiddlewareAttachments(ctx);
  validateResourceMiddlewareAttachments(ctx);
  validateSubtreeMiddlewareAttachments(ctx);
}

function validateTaskMiddlewareAttachments(ctx: ValidatorContext): void {
  for (const { task } of ctx.registry.tasks.values()) {
    for (const middlewareAttachment of task.middleware) {
      const middlewareId = ctx.resolveReferenceId(middlewareAttachment);
      if (!middlewareId || !ctx.registry.taskMiddlewares.has(middlewareId)) {
        middlewareNotRegisteredError.throw({
          type: "task",
          source: ctx.toPublicId(task),
          middlewareId: ctx.toPublicId(middlewareAttachment),
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
          source: ctx.toPublicId(resource),
          middlewareId: ctx.toPublicId(middlewareAttachment),
        });
      }
    }
  }
}

function validateSubtreeMiddlewareAttachments(ctx: ValidatorContext): void {
  for (const { resource: ownerResource } of ctx.registry.resources.values()) {
    const subtreePolicy = ownerResource.subtree;
    if (!subtreePolicy) {
      continue;
    }

    for (const middlewareEntry of subtreePolicy.tasks?.middleware ?? []) {
      const middleware = getSubtreeTaskMiddlewareAttachment(middlewareEntry);
      const middlewareId = ctx.resolveReferenceId(middleware);
      if (!middlewareId || !ctx.registry.taskMiddlewares.has(middlewareId)) {
        middlewareNotRegisteredError.throw({
          type: "task",
          source: ctx.toPublicId(ownerResource),
          middlewareId: ctx.toPublicId(middleware),
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
          source: ctx.toPublicId(ownerResource),
          middlewareId: ctx.toPublicId(middleware),
        });
      }
    }
  }
}
