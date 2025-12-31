export interface DurableSignalId<TPayload = unknown> {
  id: string;
  /**
   * Phantom field used only for type inference. Not present at runtime.
   * The payload type is carried through the object type.
   */
  readonly __payload?: TPayload;
}

export interface DurableStepId<TResult = unknown> {
  id: string;
  /**
   * Phantom field used only for type inference. Not present at runtime.
   * The result type is carried through the object type.
   */
  readonly __result?: TResult;
}

export function createDurableSignalId<TPayload>(
  id: string,
): DurableSignalId<TPayload> {
  return { id };
}

export function createDurableStepId<TResult>(id: string): DurableStepId<TResult> {
  return { id };
}

