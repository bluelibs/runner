import { eventCycleDepthExceededError, eventCycleError } from "../../errors";
import { getPlatform, IAsyncLocalStorage } from "../../platform";
import { IEmissionFrame } from "./types";
import { RuntimeCallSource } from "../../types/runtimeSource";

const MAX_EMISSION_STACK_DEPTH = 1000;

/**
 * Tracks event emission chains to detect cycles and prevent infinite loops.
 * Disabled on platforms without AsyncLocalStorage.
 */
export class CycleContext {
  private readonly emissionStack: IAsyncLocalStorage<IEmissionFrame[]> | null;
  private readonly currentHookIdContext: IAsyncLocalStorage<string> | null;
  readonly isEnabled: boolean;

  constructor(runtimeEventCycleDetection: boolean) {
    const platform = getPlatform();
    if (platform.hasAsyncLocalStorage() && runtimeEventCycleDetection) {
      this.emissionStack = platform.createAsyncLocalStorage<IEmissionFrame[]>();
      this.currentHookIdContext = platform.createAsyncLocalStorage<string>();
      this.isEnabled = true;
    } else {
      this.emissionStack = null;
      this.currentHookIdContext = null;
      this.isEnabled = false;
    }
  }

  runEmission<TResult>(
    frame: IEmissionFrame,
    processEmission: () => Promise<TResult>,
  ): Promise<TResult> {
    if (!this.isEnabled) return processEmission();

    // After the isEnabled guard, both stores are guaranteed non-null by construction.
    const emissionStack = this.emissionStack!;
    const hookIdContext = this.currentHookIdContext!;

    const currentStack = emissionStack.getStore();
    if (currentStack) {
      this.assertNoCycle(currentStack, frame, hookIdContext);
      this.assertDepthLimit(currentStack, frame);
    }

    const nextStack = currentStack ? [...currentStack, frame] : [frame];
    return emissionStack.run(nextStack, processEmission);
  }

  runHook<T>(hookId: string, execute: () => Promise<T>): Promise<T> {
    if (!this.isEnabled) return execute();
    return this.currentHookIdContext!.run(hookId, execute);
  }

  private assertNoCycle(
    stack: IEmissionFrame[],
    frame: IEmissionFrame,
    hookIdContext: IAsyncLocalStorage<string>,
  ): void {
    const cycleStart = stack.findIndex((f) => f.id === frame.id);
    if (cycleStart === -1) return;

    const top = stack[stack.length - 1];
    const currentHookId = hookIdContext.getStore();

    // Allow re-emission of the same event by the same hook ("idempotent re-emit"),
    // BUT ONLY IF the source is changing (e.g. initial->hook).
    // If the source is unchanged (hook->hook), the hook triggered itself — infinite loop.
    const hasSameSourceInCycle = stack
      .slice(cycleStart)
      .some((f) => this.sameSource(f.source, frame.source));
    const isSafeReEmit =
      top.id === frame.id &&
      currentHookId &&
      currentHookId === frame.source.path &&
      !this.sameSource(top.source, frame.source) &&
      !hasSameSourceInCycle;

    if (!isSafeReEmit) {
      eventCycleError.throw({
        path: [...stack.slice(cycleStart), frame],
      });
    }
  }

  private assertDepthLimit(
    stack: IEmissionFrame[],
    frame: IEmissionFrame,
  ): void {
    if (stack.length >= MAX_EMISSION_STACK_DEPTH) {
      eventCycleDepthExceededError.throw({
        eventId: frame.id,
        currentDepth: stack.length,
        maxDepth: MAX_EMISSION_STACK_DEPTH,
      });
    }
  }

  private sameSource(a: RuntimeCallSource, b: RuntimeCallSource): boolean {
    return a.kind === b.kind && a.path === b.path;
  }
}
