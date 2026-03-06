import { duplicateRegistrationError } from "../errors";
import type { StoreRegistry } from "./StoreRegistry";
import {
  ValidatorContext,
  validateMiddlewareRegistrations,
  validateEventConstraints,
  validateSubtreePolicies,
  validateTagConstraints,
  validateIsolationPolicies,
  normalizeIsolationEntries as normalizeIsolationEntriesImpl,
  normalizeExportEntries as normalizeExportEntriesImpl,
} from "./validators";
import type { IsolationExportsTarget, IsolationTarget } from "../defs";

/**
 * Orchestrates all store validation checks.
 * Delegates to specialized validators for each concern.
 */
export class StoreValidator {
  private readonly ctx: ValidatorContext;

  /**
   * Direct access to the registeredIds set for testing purposes.
   * @internal
   */
  get registeredIds(): Set<string> {
    return this.ctx.getRegisteredIdsMutable();
  }

  constructor(private registry: StoreRegistry) {
    this.ctx = new ValidatorContext(registry);
  }

  trackRegisteredId(id: string): void {
    this.ctx.trackRegisteredId(id);
  }

  checkIfIDExists(id: string): void | never {
    if (!this.ctx.hasRegisteredId(id)) {
      return;
    }
    const publicId = this.ctx.toPublicId(id);

    if (this.registry.tasks.has(id)) {
      duplicateRegistrationError.throw({ type: "Task", id: publicId });
    }
    if (this.registry.resources.has(id)) {
      duplicateRegistrationError.throw({ type: "Resource", id: publicId });
    }
    if (this.registry.events.has(id)) {
      duplicateRegistrationError.throw({ type: "Event", id: publicId });
    }
    if (this.registry.errors.has(id)) {
      duplicateRegistrationError.throw({ type: "Error", id: publicId });
    }
    if (this.registry.asyncContexts.has(id)) {
      duplicateRegistrationError.throw({ type: "AsyncContext", id: publicId });
    }
    if (this.registry.taskMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id: publicId });
    }
    if (this.registry.resourceMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id: publicId });
    }
    if (this.registry.tags.has(id)) {
      duplicateRegistrationError.throw({ type: "Tag", id: publicId });
    }
    if (this.registry.hooks.has(id)) {
      duplicateRegistrationError.throw({ type: "Hook", id: publicId });
    }

    duplicateRegistrationError.throw({ type: "Unknown", id: publicId });
  }

  runSanityChecks(): void {
    validateMiddlewareRegistrations(this.ctx);
    validateEventConstraints(this.ctx);
    validateSubtreePolicies(this.ctx);
    validateTagConstraints(this.ctx);
    validateIsolationPolicies(this.ctx);

    // Validate module boundary visibility after all items are registered
    this.registry.visibilityTracker.validateVisibility(this.registry);
  }

  /**
   * Normalizes isolation entries. Exposed for testing purposes.
   * @internal
   */
  normalizeIsolationEntries(input: {
    entries: ReadonlyArray<unknown>;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  }): Array<IsolationTarget> {
    return normalizeIsolationEntriesImpl<IsolationTarget>(this.ctx, input);
  }

  /**
   * Normalizes export entries. Exposed for testing purposes.
   * @internal
   */
  normalizeExportEntries(input: {
    entries: ReadonlyArray<unknown>;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  }): Array<IsolationExportsTarget> {
    return normalizeExportEntriesImpl(this.ctx, input);
  }
}
