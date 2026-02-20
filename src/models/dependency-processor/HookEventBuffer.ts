import type { IEventEmission } from "../../defs";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import {
  HookDependencyState,
  HookStoreElementType,
} from "../../types/storeTypes";

export class HookEventBuffer {
  private static readonly MAX_FLUSH_PASSES_WITHOUT_CYCLE_DETECTION = 128;
  public readonly pendingHookEvents = new Map<string, IEventEmission<any>[]>();
  public readonly drainingHookIds = new Set<string>();

  constructor(
    private readonly eventManager: EventManager,
    private readonly logger: Logger,
    private readonly runtimeEventCycleDetection: boolean,
  ) {}

  enqueue(hookId: string, event: IEventEmission<any>): void {
    const queue = this.pendingHookEvents.get(hookId);
    if (queue) {
      queue.push(event);
      return;
    }
    this.pendingHookEvents.set(hookId, [event]);
  }

  async flush(hookStoreElement: HookStoreElementType): Promise<void> {
    if (hookStoreElement.dependencyState !== HookDependencyState.Ready) {
      return;
    }

    const hook = hookStoreElement.hook;
    if (this.drainingHookIds.has(hook.id)) {
      return;
    }

    if (!this.pendingHookEvents.has(hook.id)) {
      return;
    }

    this.drainingHookIds.add(hook.id);
    try {
      let flushPasses = 0;
      while (true) {
        flushPasses += 1;
        if (
          !this.runtimeEventCycleDetection &&
          flushPasses > HookEventBuffer.MAX_FLUSH_PASSES_WITHOUT_CYCLE_DETECTION
        ) {
          await this.logger.error(
            `Aborting buffered hook event flush for "${hook.id}" after ${flushPasses - 1} passes because runtime event cycle detection is disabled.`,
          );
          break;
        }

        const queue = this.pendingHookEvents.get(hook.id);
        if (!queue || queue.length === 0) {
          this.pendingHookEvents.delete(hook.id);
          break;
        }
        this.pendingHookEvents.delete(hook.id);

        for (const queuedEvent of queue) {
          if (queuedEvent.source === hook.id) {
            continue;
          }
          await this.eventManager.executeHookWithInterceptors(
            hook,
            queuedEvent,
            hookStoreElement.computedDependencies,
          );
        }
      }
    } finally {
      this.drainingHookIds.delete(hook.id);
    }
  }
}
