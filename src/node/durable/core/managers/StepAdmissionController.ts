import { createCancellationErrorFromSignal } from "../../../../tools/abortSignals";
import { durableExecutionInvariantError } from "../../../../errors";
import { Match } from "../../../../tools/check";
import type { DurableStepConcurrency } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import { StoreAdmissionController } from "./StoreAdmissionController";
import type { StoreAdmission } from "./StoreAdmissionController";

const positiveInteger = Match.Range({ min: 1, integer: true });
const concurrencySchema = Match.compile(
  Match.OneOf(
    positiveInteger,
    { key: Match.Optional(Match.NonEmptyString), limit: positiveInteger },
    {
      key: Match.Optional(Match.NonEmptyString),
      windowMs: positiveInteger,
      max: positiveInteger,
    },
  ),
);

/** Validates and snapshots step concurrency before the first asynchronous boundary. */
export function parseStepConcurrency(
  policy: DurableStepConcurrency,
): DurableStepConcurrency {
  const validated = concurrencySchema.parse(policy);
  return typeof validated === "number" ? validated : { ...validated };
}

/** Acquires a step lease or durably parks the current workflow attempt. */
export async function acquireStepAdmission(params: {
  store: IDurableStore;
  executionId: string;
  stepId: string;
  policy: DurableStepConcurrency;
  lockState: ExecutionLockState;
  signal: AbortSignal;
}): Promise<Extract<StoreAdmission, { kind: "admitted" }>> {
  let key: string;
  const sharedKey =
    typeof params.policy === "number" ? undefined : params.policy.key;
  if (sharedKey !== undefined) {
    key = JSON.stringify(["shared", sharedKey]);
  } else {
    const execution = await params.store.getExecution(params.executionId);
    if (!execution?.workflowKey) {
      throw durableExecutionInvariantError.new({
        message: `Step '${params.stepId}' requires a persisted workflow key for admission.`,
      });
    }
    // Tuple encoding preserves storage identity even when IDs contain separators.
    key = JSON.stringify(["workflow", execution.workflowKey, params.stepId]);
  }

  const controller = new StoreAdmissionController(params.store, "step");
  let admission: StoreAdmission;
  try {
    admission = await controller.tryAdmit({
      policy:
        typeof params.policy === "number"
          ? params.policy
          : params.policy.limit !== undefined
            ? params.policy.limit
            : { windowMs: params.policy.windowMs, max: params.policy.max },
      key,
      executionLockState: params.lockState,
      signal: params.signal,
    });
  } catch (error) {
    if (params.signal.aborted) {
      // The attempt runner recognises typed pause/shutdown interruptions, not raw abort reasons.
      throw createCancellationErrorFromSignal(
        params.signal,
        `Durable step '${params.stepId}' cancelled`,
      );
    }
    throw error;
  }

  if (admission.kind === "deferred") {
    await controller.defer(params.executionId, admission.retryAfterMs);
    throw new SuspensionSignal("step-concurrency");
  }
  return admission;
}
