import type { TagType } from "../../defs";
import { getPlatform } from "../../platform";
import { getStoredSubtreePolicy } from "../../definers/subtreePolicy";
import { globalTags } from "../../globals/globalTags";
import { identityCheckerTaskMiddleware } from "../../globals/middleware/identityChecker.middleware";
import {
  normalizeIdentityScopeConfig,
  type IdentityScopeConfig,
} from "../../globals/middleware/identityScope.shared";
import { identityFeatureRequiresAsyncLocalStorageError } from "../../errors";
import {
  getSubtreeMiddlewareDuplicateKey,
  getSubtreeTaskMiddlewareAttachment,
} from "../../tools/subtreeMiddleware";
import type { ValidatorContext } from "./ValidatorContext";

type TaskMiddlewareAttachmentWithConfig = {
  id: string;
  config?: {
    identityScope?: IdentityScopeConfig;
  };
  tags: TagType[];
};

/**
 * Fails fast when explicit identity-sensitive task policies are configured on a
 * platform without AsyncLocalStorage support.
 */
export function validateIdentityAsyncContextSupport(
  ctx: ValidatorContext,
): void {
  if (getPlatform().hasAsyncLocalStorage()) {
    return;
  }

  for (const { task } of ctx.registry.tasks.values()) {
    for (const middlewareAttachment of task.middleware) {
      assertTaskMiddlewareIdentitySupport(
        ctx,
        middlewareAttachment as TaskMiddlewareAttachmentWithConfig,
        task.id,
      );
    }
  }

  for (const { resource } of ctx.registry.resources.values()) {
    const subtreePolicy = getStoredSubtreePolicy(resource);
    if (!subtreePolicy) {
      continue;
    }

    if (subtreePolicy.tasks?.identity?.length) {
      identityFeatureRequiresAsyncLocalStorageError.throw({
        feature: "subtree.tasks.identity",
        sourceId: resource.id,
      });
    }

    if (
      subtreePolicy.middleware?.identityScope !== undefined &&
      normalizeIdentityScopeConfig(subtreePolicy.middleware.identityScope)
        .tenant
    ) {
      identityFeatureRequiresAsyncLocalStorageError.throw({
        feature: "subtree.middleware.identityScope",
        sourceId: resource.id,
      });
    }

    for (const middlewareEntry of subtreePolicy.tasks?.middleware ?? []) {
      assertTaskMiddlewareIdentitySupport(
        ctx,
        getSubtreeTaskMiddlewareAttachment(
          middlewareEntry,
        ) as TaskMiddlewareAttachmentWithConfig,
        resource.id,
      );
    }
  }
}

function assertTaskMiddlewareIdentitySupport(
  ctx: ValidatorContext,
  middlewareAttachment: TaskMiddlewareAttachmentWithConfig,
  sourceId: string,
): void {
  const middlewareId =
    ctx.resolveReferenceId(middlewareAttachment) ??
    ctx.findIdByDefinition(middlewareAttachment);
  const middlewareKey = getSubtreeMiddlewareDuplicateKey(middlewareId);

  if (middlewareKey === identityCheckerTaskMiddleware.id) {
    identityFeatureRequiresAsyncLocalStorageError.throw({
      feature: `task middleware "${middlewareKey}"`,
      sourceId,
    });
  }

  const config = middlewareAttachment.config;
  if (
    globalTags.identityScoped.exists(middlewareAttachment) &&
    config?.identityScope !== undefined &&
    normalizeIdentityScopeConfig(config.identityScope).tenant
  ) {
    identityFeatureRequiresAsyncLocalStorageError.throw({
      feature: `identityScope on task middleware "${middlewareKey}"`,
      sourceId,
    });
  }
}
