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
  private readonly validatorContext: ValidatorContext;

  /**
   * Direct access to the registeredIds set for testing purposes.
   * @internal
   */
  get registeredIds(): Set<string> {
    return this.validatorContext.getRegisteredIdsMutable();
  }

  constructor(private registry: StoreRegistry) {
    this.validatorContext = new ValidatorContext(registry);
  }

  trackRegisteredId(id: string): void {
    this.validatorContext.trackRegisteredId(id);
  }

  checkIfIDExists(id: string): void | never {
    if (!this.validatorContext.hasRegisteredId(id)) {
      return;
    }
    const canonicalId = this.validatorContext.findIdByDefinition(id);

    if (this.registry.tasks.has(id)) {
      duplicateRegistrationError.throw({ type: "Task", id: canonicalId });
    }
    if (this.registry.resources.has(id)) {
      duplicateRegistrationError.throw({ type: "Resource", id: canonicalId });
    }
    if (this.registry.events.has(id)) {
      duplicateRegistrationError.throw({ type: "Event", id: canonicalId });
    }
    if (this.registry.errors.has(id)) {
      duplicateRegistrationError.throw({ type: "Error", id: canonicalId });
    }
    if (this.registry.asyncContexts.has(id)) {
      duplicateRegistrationError.throw({
        type: "AsyncContext",
        id: canonicalId,
      });
    }
    if (this.registry.taskMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id: canonicalId });
    }
    if (this.registry.resourceMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id: canonicalId });
    }
    if (this.registry.tags.has(id)) {
      duplicateRegistrationError.throw({ type: "Tag", id: canonicalId });
    }
    if (this.registry.hooks.has(id)) {
      duplicateRegistrationError.throw({ type: "Hook", id: canonicalId });
    }

    duplicateRegistrationError.throw({ type: "Unknown", id: canonicalId });
  }

  runSanityChecks(): void {
    validateMiddlewareRegistrations(this.validatorContext);
    validateEventConstraints(this.validatorContext);
    validateSubtreePolicies(this.validatorContext);
    validateTagConstraints(this.validatorContext);
    validateIsolationPolicies(this.validatorContext);

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
    return normalizeIsolationEntriesImpl<IsolationTarget>(
      this.validatorContext,
      input,
    );
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
    return normalizeExportEntriesImpl(this.validatorContext, input);
  }
}
