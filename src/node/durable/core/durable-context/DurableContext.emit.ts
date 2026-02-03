import type { IEventBus } from "../interfaces/bus";
import type {
  EmitOptions,
  IStepBuilder,
  StepOptions,
} from "../interfaces/context";
import type { IEventDefinition } from "../../../../types/event";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";

function nextIndex(counter: Map<string, number>, key: string): number {
  const current = counter.get(key) ?? 0;
  counter.set(key, current + 1);
  return current;
}

export async function emitDurably<TPayload>(params: {
  bus: IEventBus;
  assertNotCancelled: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  assertOrWarnImplicitInternalStepId: (
    kind: "sleep" | "emit" | "waitForSignal",
  ) => void;
  emitIndexes: Map<string, number>;
  internalStep: <T>(stepId: string, options?: StepOptions) => IStepBuilder<T>;
  event: IEventDefinition<TPayload>;
  payload: TPayload;
  options?: EmitOptions;
}): Promise<void> {
  await params.assertNotCancelled();

  const eventId = params.event.id;

  let stepId: string;
  if (params.options?.stepId) {
    stepId = `__emit:${params.options.stepId}`;
  } else {
    params.assertOrWarnImplicitInternalStepId("emit");
    const emitIndex = nextIndex(params.emitIndexes, eventId);
    stepId = `__emit:${eventId}:${emitIndex}`;
  }

  params.assertUniqueStepId(stepId);

  await params.internalStep<void>(stepId).up(async () => {
    await params.bus.publish("durable:events", {
      type: eventId,
      payload: params.payload,
      timestamp: new Date(),
    });

    await params.appendAuditEntry({
      kind: DurableAuditEntryKind.EmitPublished,
      stepId,
      eventId,
    });
  });
}
