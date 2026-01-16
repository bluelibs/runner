import type { IEventDefinition } from "../../../types/event";

export type DurableSignalId<TPayload = unknown> = IEventDefinition<TPayload>;

export interface DurableStepId<TResult = unknown> {
  id: string;
  /**
   * Phantom field used only for type inference. Not present at runtime.
   * The result type is carried through the object type.
   */
  readonly __result?: TResult;
}

export function createDurableStepId<TResult>(
  id: string,
): DurableStepId<TResult> {
  return { id };
}
