import { IEvent } from "../defs";
import { globalEvents } from "../globals/globalEvents";
import { Logger } from "../models/Logger";
import { RuntimeCallSource } from "../types/runtimeSource";
import { createDisposalBudget } from "./disposalBudget";
import { waitForDisposeDrainBudget } from "./processShutdownHooks";
import { resolveShutdownDrainWarningDecision } from "./shutdownDrainWarning";

type LifecycleStore = {
  beginCoolingDown(): void;
  beginDisposing(): void;
  cooldown(): Promise<void>;
  beginDrained(): void;
  waitForDrain(timeoutMs: number): Promise<boolean>;
};

type LifecycleEventManager = {
  emitLifecycle<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: RuntimeCallSource,
    options?: {
      throwOnError?: boolean;
      failureMode?: "fail-fast" | "aggregate";
    },
  ): Promise<void | unknown>;
};

export type ShutdownDisposalLifecycleInput = {
  store: LifecycleStore;
  eventManager: LifecycleEventManager;
  runLogger: Logger;
  runtimeLifecycleSource: RuntimeCallSource;
  dispose: {
    totalBudgetMs: number;
    drainingBudgetMs: number;
    cooldownWindowMs: number;
  };
  disposeAll: (
    disposalBudget: ReturnType<typeof createDisposalBudget>,
  ) => Promise<void>;
};

export type DisposeRunArtifactsInput = {
  store: {
    dispose(): Promise<void>;
  };
  disposalBudget?: ReturnType<typeof createDisposalBudget>;
  takeUnhookProcessSafetyNets: () => (() => void) | undefined;
  takeUnhookShutdown: () => (() => void) | undefined;
  onBeforeStoreDispose: () => void;
};

export async function runShutdownDisposalLifecycle(
  input: ShutdownDisposalLifecycleInput,
): Promise<void> {
  const disposalBudget = createDisposalBudget(input.dispose.totalBudgetMs);
  input.store.beginCoolingDown();

  await disposalBudget.waitWithinBudget(() => input.store.cooldown());
  await waitForCooldownWindow(disposalBudget, input.dispose.cooldownWindowMs);
  // Freeze admissions only after all cooldown hooks had a chance to stop ingress
  // and register any shutdown-specific source allowances.
  input.store.beginDisposing();
  await disposalBudget.waitWithinBudget(() =>
    emitLifecycleEvent(
      input.eventManager,
      globalEvents.disposing,
      input.runtimeLifecycleSource,
    ),
  );

  const effectiveDrainBudgetMs = disposalBudget.capByRemainingBudget(
    input.dispose.drainingBudgetMs,
  );
  const drainWait = await disposalBudget.waitWithinBudget(() =>
    waitForDisposeDrainBudget(input.store, effectiveDrainBudgetMs),
  );
  const drainWarning = resolveShutdownDrainWarningDecision({
    requestedDrainBudgetMs: input.dispose.drainingBudgetMs,
    effectiveDrainBudgetMs,
    drainWaitResult: drainWait.completed
      ? {
          completed: true,
          drained: drainWait.value,
        }
      : { completed: false },
  });

  if (drainWarning.shouldWarn) {
    try {
      await input.runLogger.warn(
        "Shutdown drain did not complete within budget; continuing disposal.",
        {
          source: "run",
          data: {
            reason: drainWarning.reason,
            requestedDrainBudgetMs: input.dispose.drainingBudgetMs,
            effectiveDrainBudgetMs,
            remainingDisposeBudgetMs: disposalBudget.remainingMs(),
          },
        },
      );
    } catch {
      // Logging must never block shutdown progression.
    }
  }

  input.store.beginDrained();
  await disposalBudget.waitWithinBudget(() =>
    emitLifecycleEvent(
      input.eventManager,
      globalEvents.drained,
      input.runtimeLifecycleSource,
    ),
  );

  await input.disposeAll(disposalBudget);
}

export async function disposeRunArtifacts(
  input: DisposeRunArtifactsInput,
): Promise<void> {
  try {
    input.onBeforeStoreDispose();
    await waitForStoreDisposeWithinBudget(input.store, input.disposalBudget);
  } finally {
    input.takeUnhookProcessSafetyNets()?.();
    input.takeUnhookShutdown()?.();
  }
}

async function emitLifecycleEvent(
  eventManager: LifecycleEventManager,
  event: (typeof globalEvents)[keyof typeof globalEvents],
  runtimeLifecycleSource: RuntimeCallSource,
): Promise<void> {
  await eventManager.emitLifecycle(event, undefined, runtimeLifecycleSource, {
    throwOnError: false,
    failureMode: "aggregate",
  });
}

async function waitForCooldownWindow(
  disposalBudget: ReturnType<typeof createDisposalBudget>,
  cooldownWindowMs: number,
): Promise<void> {
  const effectiveCooldownWindowMs =
    disposalBudget.capByRemainingBudget(cooldownWindowMs);
  if (effectiveCooldownWindowMs <= 0) {
    return;
  }

  await disposalBudget.waitWithinBudget(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, effectiveCooldownWindowMs);
      }),
  );
}

async function waitForStoreDisposeWithinBudget(
  store: {
    dispose(): Promise<void>;
  },
  disposalBudget?: ReturnType<typeof createDisposalBudget>,
): Promise<void> {
  if (!disposalBudget) {
    await store.dispose();
    return;
  }

  const remainingBudgetMs = disposalBudget.remainingMs();
  if (remainingBudgetMs <= 0) {
    void store.dispose().catch(() => undefined);
    return;
  }

  await disposalBudget.waitWithinBudget(() => store.dispose());
}
