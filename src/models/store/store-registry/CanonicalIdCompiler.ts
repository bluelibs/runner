import { validationError } from "../../../errors";
import { isReservedDefinitionLocalName } from "../../../definers/assertDefinitionId";
import { RegisterableKind } from "./registerableKind";
import type { OwnerScope } from "./OwnerScope";

export class CanonicalIdCompiler {
  compute(
    ownerScope: OwnerScope,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    this.assertLocalName(ownerScope.resourceId, kind, currentId);

    if (currentId.startsWith(`${ownerScope.resourceId}.`)) {
      return currentId;
    }

    if (ownerScope.usesFrameworkRootIds) {
      return this.computeFrameworkRootId(kind, currentId);
    }

    return this.computeOwnedId(ownerScope.resourceId, kind, currentId);
  }

  private computeFrameworkRootId(
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    switch (kind) {
      case RegisterableKind.Resource:
        return currentId;
      case RegisterableKind.Task:
        return `tasks.${currentId}`;
      case RegisterableKind.Event:
        return `events.${currentId}`;
      case RegisterableKind.Hook:
        return `hooks.${currentId}`;
      case RegisterableKind.TaskMiddleware:
        return `middleware.task.${currentId}`;
      case RegisterableKind.ResourceMiddleware:
        return `middleware.resource.${currentId}`;
      case RegisterableKind.Tag:
        return `tags.${currentId}`;
      case RegisterableKind.Error:
        return `errors.${currentId}`;
      case RegisterableKind.AsyncContext:
        return `asyncContexts.${currentId}`;
      default:
        return currentId;
    }
  }

  private computeOwnedId(
    ownerResourceId: string,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    switch (kind) {
      case RegisterableKind.Resource:
        return `${ownerResourceId}.${currentId}`;
      case RegisterableKind.Task:
        return `${ownerResourceId}.tasks.${currentId}`;
      case RegisterableKind.Event:
        return `${ownerResourceId}.events.${currentId}`;
      case RegisterableKind.Hook:
        return `${ownerResourceId}.hooks.${currentId}`;
      case RegisterableKind.TaskMiddleware:
        return `${ownerResourceId}.middleware.task.${currentId}`;
      case RegisterableKind.ResourceMiddleware:
        return `${ownerResourceId}.middleware.resource.${currentId}`;
      case RegisterableKind.Tag:
        return `${ownerResourceId}.tags.${currentId}`;
      case RegisterableKind.Error:
        return `${ownerResourceId}.errors.${currentId}`;
      case RegisterableKind.AsyncContext:
        return `${ownerResourceId}.asyncContexts.${currentId}`;
      default:
        return `${ownerResourceId}.${currentId}`;
    }
  }

  private assertLocalName(
    ownerResourceId: string,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): void {
    if (currentId.trim().length === 0) {
      validationError.throw({
        subject: "Definition local name",
        id: `${ownerResourceId}.${kind}`,
        originalError:
          "Definition local names must be non-empty strings when using scoped registration.",
      });
    }

    if (isReservedDefinitionLocalName(currentId)) {
      validationError.throw({
        subject: "Definition local name",
        id: `${ownerResourceId}.${kind}.${currentId}`,
        originalError: `Local name "${currentId}" is reserved by Runner and cannot be used.`,
      });
    }
  }
}
