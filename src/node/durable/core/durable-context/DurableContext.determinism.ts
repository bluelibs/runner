import { durableDeterminismViolationError } from "../../../../errors";
export type ImplicitInternalStepIdKind = "sleep" | "emit" | "waitForSignal";
export type ImplicitInternalStepIdsPolicy = "allow" | "warn" | "error";

export type DurableContextDeterminism = {
  assertOrWarnImplicitInternalStepId: (
    kind: ImplicitInternalStepIdKind,
  ) => void;
  assertUniqueStepId: (stepId: string) => void;
  assertUserStepId: (stepId: string) => void;
};

export function createDurableContextDeterminism(params: {
  policy: ImplicitInternalStepIdsPolicy;
  warnedKinds: Set<ImplicitInternalStepIdKind>;
  seenStepIds: Set<string>;
  warn: (message: string) => void;
}): DurableContextDeterminism {
  const assertOrWarnImplicitInternalStepId = (
    kind: ImplicitInternalStepIdKind,
  ): void => {
    const policy = params.policy;
    if (policy === "allow") return;

    const message =
      `DurableContext.${kind}() is using an implicit step id (call-order based). ` +
      `This can break replay for in-flight executions after refactors. ` +
      `Provide a stable id via { stepId: "..." } (or set determinism.implicitInternalStepIds to "allow").`;

    if (policy === "error") {
      durableDeterminismViolationError.throw({ message });
    }

    if (params.warnedKinds.has(kind)) return;
    params.warnedKinds.add(kind);

    params.warn(message);
  };

  const assertUniqueStepId = (stepId: string): void => {
    if (params.seenStepIds.has(stepId)) {
      durableDeterminismViolationError.throw({
        message: `Duplicate step ID detected: '${stepId}'. Step IDs must be unique within a single execution path to ensure deterministic replay.`,
      });
    }
    params.seenStepIds.add(stepId);
  };

  const assertUserStepId = (stepId: string): void => {
    if (stepId.startsWith("__")) {
      durableDeterminismViolationError.throw({
        message: `Step IDs starting with '__' are reserved for durable internals: '${stepId}'`,
      });
    }

    if (stepId.startsWith("rollback:")) {
      durableDeterminismViolationError.throw({
        message: `Step IDs starting with 'rollback:' are reserved for durable internals: '${stepId}'`,
      });
    }
  };

  return {
    assertOrWarnImplicitInternalStepId,
    assertUniqueStepId,
    assertUserStepId,
  };
}
