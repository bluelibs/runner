import type { IEventEmission } from "../../defs";
import { hookEventBufferFlushAbortedError } from "../../errors";
import { EventManager } from "../EventManager";
import type { Store } from "../store/Store";
import {
  HookDependencyState,
  HookStoreElementType,
} from "../../types/storeTypes";
import { ExecutionContextStore } from "../ExecutionContextStore";

export class HookEventBuffer {
  private static readonly MAX_FLUSH_PASSES_WITHOUT_CYCLE_DETECTION = 128;
  public readonly pendingHookEvents = new Map<string, IEventEmission<any>[]>();
  public readonly drainingHookIds = new Set<string>();

  constructor(
    private readonly eventManager: EventManager,
    private readonly executionContextStore: ExecutionContextStore,
  ) {}

  /**
   * Attaches listeners for all registered hooks, buffering emissions until dependencies are ready.
   */
  attachListeners(store: Store): void {
    for (const hookStoreElement of store.hooks.values()) {
      const hook = hookStoreElement.hook;
      if (hook.on) {
        const handler = async (receivedEvent: IEventEmission<any>) => {
          if (hookStoreElement.dependencyState !== HookDependencyState.Ready) {
            this.enqueue(hook.id, receivedEvent);
            return;
          }
          if (this.pendingHookEvents.has(hook.id)) {
            await this.flush(hookStoreElement);
          }
          return this.eventManager.executeHookWithInterceptors(
            hook,
            receivedEvent,
            hookStoreElement.computedDependencies,
          );
        };

        const order = hook.order ?? 0;
        const hookListenerId = hook.id;

        if (hook.on === "*") {
          this.eventManager.addGlobalListener(handler, {
            order,
            id: hookListenerId,
          });
        } else {
          const resolvedEvents = store
            .resolveHookTargets(hook)
            .map((entry) => entry.event);

          if (resolvedEvents.length === 0) {
            // Selector-based hooks may resolve to no visible events after
            // bootstrap narrowing, in which case no listener should be attached.
            continue;
          }

          if (resolvedEvents.length === 1) {
            this.eventManager.addListener(resolvedEvents[0], handler, {
              order,
              id: hookListenerId,
            });
            continue;
          }

          this.eventManager.addListener(resolvedEvents, handler, {
            order,
            id: hookListenerId,
          });
        }
      }
    }
  }

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
          !this.executionContextStore.isCycleDetectionEnabled &&
          flushPasses > HookEventBuffer.MAX_FLUSH_PASSES_WITHOUT_CYCLE_DETECTION
        ) {
          hookEventBufferFlushAbortedError.throw({
            hookId: hook.id,
            flushPasses: flushPasses - 1,
          });
        }

        const queue = this.pendingHookEvents.get(hook.id);
        if (!queue || queue.length === 0) {
          this.pendingHookEvents.delete(hook.id);
          break;
        }
        this.pendingHookEvents.delete(hook.id);

        for (const queuedEvent of queue) {
          if (queuedEvent.source.id === hook.id) {
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
