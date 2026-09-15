import type { IDurableStore } from "../../core/interfaces/store";
import { restoreArchivedExecution } from "./archiver";
import {
  listAuditEntriesThroughTiers,
  listSignalStatesThroughTiers,
} from "./tieredReads";

/**
 * Forwards one optional hot-only capability, preserving `undefined` when
 * hot lacks it so runtime capability checks behave exactly as with hot.
 */
function bindOptionalMethod<Target, Key extends keyof Target>(
  target: Target,
  key: Key,
): Target[Key] | undefined {
  const candidate: unknown = target[key];
  if (typeof candidate !== "function") {
    return undefined;
  }
  return candidate.bind(target) as Target[Key] | undefined;
}

/**
 * Combines one lifecycle hook across both tiers, staying `undefined` when
 * neither tier defines it.
 */
function combineLifecycle(
  hotFn: (() => Promise<void>) | undefined,
  coldFn: (() => Promise<void>) | undefined,
): (() => Promise<void>) | undefined {
  if (!hotFn && !coldFn) {
    return undefined;
  }
  return async (): Promise<void> => {
    if (hotFn) {
      await hotFn();
    }
    if (coldFn) {
      await coldFn();
    }
  };
}

/**
 * Builds the tiered store's optional capabilities: hot-only forwards,
 * either-tier lifecycle hooks, merged tier reads, and operator actions
 * that restore archived executions to hot before delegating.
 */
export function createTieredCapabilities(
  hot: IDurableStore,
  cold: IDurableStore,
): Partial<IDurableStore> {
  const capabilities: Partial<IDurableStore> = {
    appendAuditEntry: bindOptionalMethod(hot, "appendAuditEntry"),
    commitSignalDelivery: bindOptionalMethod(hot, "commitSignalDelivery"),
    commitExecutionWaiterCompletion: bindOptionalMethod(
      hot,
      "commitExecutionWaiterCompletion",
    ),
    claimTimer: bindOptionalMethod(hot, "claimTimer"),
    renewTimerClaim: bindOptionalMethod(hot, "renewTimerClaim"),
    releaseTimerClaim: bindOptionalMethod(hot, "releaseTimerClaim"),
    finalizeClaimedTimer: bindOptionalMethod(hot, "finalizeClaimedTimer"),
    listStuckExecutions: bindOptionalMethod(hot, "listStuckExecutions"),
    acquireLock: bindOptionalMethod(hot, "acquireLock"),
    renewLock: bindOptionalMethod(hot, "renewLock"),
    releaseLock: bindOptionalMethod(hot, "releaseLock"),
    init: combineLifecycle(hot.init?.bind(hot), cold.init?.bind(cold)),
    dispose: combineLifecycle(
      hot.dispose?.bind(hot),
      cold.dispose?.bind(cold),
    ),
  };

  if (hot.listAuditEntries || cold.listAuditEntries) {
    capabilities.listAuditEntries = async (executionId, options) =>
      await listAuditEntriesThroughTiers(hot, cold, executionId, options);
  }
  if (hot.listSignalStates || cold.listSignalStates) {
    capabilities.listSignalStates = async (executionId) =>
      await listSignalStatesThroughTiers(hot, cold, executionId);
  }

  if (hot.retryRollback) {
    capabilities.retryRollback = async (executionId) => {
      await restoreBeforeOperatorAction(hot, cold, executionId);
      await hot.retryRollback!(executionId);
    };
  }
  if (hot.skipStep) {
    capabilities.skipStep = async (executionId, stepId) => {
      await restoreBeforeOperatorAction(hot, cold, executionId);
      await hot.skipStep!(executionId, stepId);
    };
  }
  if (hot.forceFail) {
    capabilities.forceFail = async (executionId, error) => {
      await restoreBeforeOperatorAction(hot, cold, executionId);
      await hot.forceFail!(executionId, error);
    };
  }
  if (hot.editStepResult) {
    capabilities.editStepResult = async (executionId, stepId, newResult) => {
      await restoreBeforeOperatorAction(hot, cold, executionId);
      await hot.editStepResult!(executionId, stepId, newResult);
    };
  }

  return capabilities;
}

/**
 * Brings an archived execution back to hot (no-op when already hot or
 * unknown) so operator actions always run against live state.
 */
async function restoreBeforeOperatorAction(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
): Promise<void> {
  await restoreArchivedExecution({ hot, cold, executionId });
}
