import { eventCycleDepthExceededError, eventCycleError } from "../../errors";
import { getPlatform, IAsyncLocalStorage } from "../../platform";
import { IEmissionFrame } from "./types";
import { RuntimeCallSource } from "../../types/runtimeSource";

const MAX_EMISSION_STACK_DEPTH = 1000;

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
    if (!this.isEnabled || !this.emissionStack || !this.currentHookIdContext) {
      return processEmission();
    }

    const currentStack = this.emissionStack.getStore();
    if (currentStack) {
      const cycleStart = currentStack.findIndex(
        (f: { id: string; source: RuntimeCallSource }) => f.id === frame.id,
      );
      if (cycleStart !== -1) {
        const top = currentStack[currentStack.length - 1];
        const currentHookId = this.currentHookIdContext.getStore();

        // Allow re-emission of the same event by the same hook ("idempotent re-emit"),
        // BUT ONLY IF the source is changing (e.g. initial->hook).
        // If the source is unchanged (hook->hook), it means the hook triggered itself, which is an infinite loop.
        const hasSameSourceInCycle = currentStack
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
            path: [...currentStack.slice(cycleStart), frame],
          });
        }
      }
    }

    if (currentStack && currentStack.length >= MAX_EMISSION_STACK_DEPTH) {
      eventCycleDepthExceededError.throw({
        eventId: frame.id,
        currentDepth: currentStack.length,
        maxDepth: MAX_EMISSION_STACK_DEPTH,
      });
    }

    const nextStack = currentStack ? [...currentStack, frame] : [frame];
    return this.emissionStack.run(nextStack, processEmission);
  }

  runHook<T>(hookId: string, execute: () => Promise<T>): Promise<T> {
    if (!this.isEnabled || !this.currentHookIdContext) {
      return execute();
    }
    return this.currentHookIdContext.run(hookId, execute);
  }

  private sameSource(a: RuntimeCallSource, b: RuntimeCallSource): boolean {
    return a.kind === b.kind && a.path === b.path;
  }
}
