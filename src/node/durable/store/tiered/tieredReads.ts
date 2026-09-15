import type { DurableAuditEntry } from "../../core/audit";
import type { IDurableStore } from "../../core/interfaces/store";
import type {
  DurableSignalState,
  Execution,
  StepResult,
} from "../../core/types";

/**
 * Whether the hot tier owns this execution. Cold is consulted only for
 * executions unknown to hot, so live traffic never pays for cold reads.
 */
async function isKnownToHot(
  hot: IDurableStore,
  executionId: string,
): Promise<boolean> {
  return (await hot.getExecution(executionId)) !== null;
}

/**
 * Reads one execution from hot, falling back to cold when hot has never
 * seen it (archived) or no longer does.
 */
export async function readExecutionThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
): Promise<Execution | null> {
  return (
    (await hot.getExecution(executionId)) ??
    (await cold.getExecution(executionId))
  );
}

/**
 * Reads one step result from hot, falling back to cold only for executions
 * unknown to hot. Hot rows always win: they can only be newer than cold.
 */
export async function readStepResultThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
  stepId: string,
): Promise<StepResult | null> {
  const hotStep = await hot.getStepResult(executionId, stepId);
  if (hotStep) {
    return hotStep;
  }
  if (await isKnownToHot(hot, executionId)) {
    return null;
  }
  return await cold.getStepResult(executionId, stepId);
}

/**
 * Merges step lists with hot rows winning per step id. Cold order is kept
 * and hot-only rows are appended, so no tier imposes its own ordering.
 */
export function mergeStepResults(
  hotSteps: StepResult[],
  coldSteps: StepResult[],
): StepResult[] {
  const merged = new Map(coldSteps.map((step) => [step.stepId, step]));
  for (const step of hotSteps) {
    merged.set(step.stepId, step);
  }
  return [...merged.values()];
}

/**
 * Lists step results from hot for live executions, else merges hot
 * leftovers (late-timer orphans) over the archived cold set.
 */
export async function listStepResultsThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
): Promise<StepResult[]> {
  if (await isKnownToHot(hot, executionId)) {
    return await hot.listStepResults(executionId);
  }
  const hotSteps = await hot.listStepResults(executionId);
  const coldSteps = await cold.listStepResults(executionId);
  return mergeStepResults(hotSteps, coldSteps);
}

/**
 * Merges audit trails with cold entries first (hot leftovers are always
 * newer) and id-dedupe for the mid-move window when both tiers hold a copy.
 */
export function mergeAuditEntries(
  hotEntries: DurableAuditEntry[],
  coldEntries: DurableAuditEntry[],
): DurableAuditEntry[] {
  const seen = new Set(coldEntries.map((entry) => entry.id));
  const merged = [...coldEntries];
  for (const entry of hotEntries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Lists audit entries from hot for live executions, else merges hot
 * leftovers over the archived cold trail. Paging options apply per tier.
 */
export async function listAuditEntriesThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
  options?: { limit?: number; offset?: number },
): Promise<DurableAuditEntry[]> {
  if (await isKnownToHot(hot, executionId)) {
    return hot.listAuditEntries
      ? await hot.listAuditEntries(executionId, options)
      : [];
  }
  const hotEntries = hot.listAuditEntries
    ? await hot.listAuditEntries(executionId, options)
    : [];
  const coldEntries = cold.listAuditEntries
    ? await cold.listAuditEntries(executionId, options)
    : [];
  return mergeAuditEntries(hotEntries, coldEntries);
}

/**
 * Reads one signal journal from hot, falling back to cold only for
 * executions unknown to hot.
 */
export async function readSignalStateThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  const hotState = await hot.getSignalState(executionId, signalId);
  if (hotState) {
    return hotState;
  }
  if (await isKnownToHot(hot, executionId)) {
    return null;
  }
  return await cold.getSignalState(executionId, signalId);
}

/**
 * Merges signal journals with hot rows winning per signal id. Cold order is
 * kept and hot-only journals are appended.
 */
export function mergeSignalStates(
  hotStates: DurableSignalState[],
  coldStates: DurableSignalState[],
): DurableSignalState[] {
  const merged = new Map(coldStates.map((state) => [state.signalId, state]));
  for (const state of hotStates) {
    merged.set(state.signalId, state);
  }
  return [...merged.values()];
}

/**
 * Lists signal journals from hot for live executions, else merges hot
 * leftovers over the archived cold set.
 */
export async function listSignalStatesThroughTiers(
  hot: IDurableStore,
  cold: IDurableStore,
  executionId: string,
): Promise<DurableSignalState[]> {
  if (await isKnownToHot(hot, executionId)) {
    return hot.listSignalStates ? await hot.listSignalStates(executionId) : [];
  }
  const hotStates = hot.listSignalStates
    ? await hot.listSignalStates(executionId)
    : [];
  const coldStates = cold.listSignalStates
    ? await cold.listSignalStates(executionId)
    : [];
  return mergeSignalStates(hotStates, coldStates);
}
