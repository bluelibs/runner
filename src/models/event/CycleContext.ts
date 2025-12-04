import { eventCycleError } from "../../errors";
import { getPlatform, IAsyncLocalStorage } from "../../platform";
import { IEmissionFrame } from "./types";

export class CycleContext {
  private readonly emissionStack: IAsyncLocalStorage<IEmissionFrame[]> | null;
  private readonly currentHookIdContext: IAsyncLocalStorage<string> | null;
  readonly isEnabled: boolean;

  constructor(runtimeCycleDetection: boolean) {
    const platform = getPlatform();
    if (platform.hasAsyncLocalStorage() && runtimeCycleDetection) {
      this.emissionStack = platform.createAsyncLocalStorage<IEmissionFrame[]>();
      this.currentHookIdContext = platform.createAsyncLocalStorage<string>();
      this.isEnabled = true;
    } else {
      this.emissionStack = null;
      this.currentHookIdContext = null;
      this.isEnabled = false;
    }
  }

  runEmission(frame: IEmissionFrame, source: string, processEmission: () => Promise<void>): Promise<void> {
    if (!this.isEnabled || !this.emissionStack || !this.currentHookIdContext) {
      return processEmission();
    }

    const currentStack = this.emissionStack.getStore();
    if (currentStack) {
      const cycleStart = currentStack.findIndex(
        (f: { id: string; source: string }) => f.id === frame.id,
      );
      if (cycleStart !== -1) {
        const top = currentStack[currentStack.length - 1];
        const currentHookId = this.currentHookIdContext.getStore();
        const safeReEmitBySameHook =
          top.id === frame.id && currentHookId && currentHookId === source;

        if (!safeReEmitBySameHook) {
          eventCycleError.throw({
            path: [...currentStack.slice(cycleStart), frame],
          });
        }
      }
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
}
