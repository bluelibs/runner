import { IEvent, IEventEmissionCallOptions } from "../defs";
import { globalEvents } from "../globals/globalEvents";
import { Logger } from "../models/Logger";
import { RuntimeCallSource } from "../types/runtimeSource";
import { createDisposalBudget } from "./disposalBudget";
import { waitForDisposeDrainBudget } from "./processShutdownHooks";
import {
  resolveShutdownDrainWarningDecision,
  ShutdownDrainWaitResult,
} from "./shutdownDrainWarning";

type LifecycleStore = {
  beginCoolingDown(): void;
  beginDisposing(): void;
  cooldown(): Promise<void>;
  beginDrained(): void;
  waitForDrain(timeoutMs: number): Promise<boolean>;
  findIdByDefinition(reference: unknown): string;
  findDefinitionById(id: string): unknown;
};

type LifecycleEventManager = {
  emitLifecycle<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    options: IEventEmissionCallOptions,
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
  disposeAll: () => Promise<void>;
};

export type DisposeRunArtifactsInput = {
  store: {
    dispose(): Promise<void>;
  };
  takeUnhookProcessSafetyNets: () => (() => void) | undefined;
  takeUnhookShutdown: () => (() => void) | undefined;
  onBeforeStoreDispose: () => void;
};

export async function runShutdownDisposalLifecycle(
  input: ShutdownDisposalLifecycleInput,
): Promise<void> {
  const disposalBudget = createDisposalBudget(input.dispose.totalBudgetMs);
  input.store.beginCoolingDown();

  await input.store.cooldown();
  await waitForCooldownWindow(disposalBudget, input.dispose.cooldownWindowMs);
  // Freeze admissions only after all cooldown hooks had a chance to stop ingress
  // and register any shutdown-specific source allowances.
  input.store.beginDisposing();
  await emitLifecycleEvent(
    input.store,
    input.eventManager,
    globalEvents.disposing,
    input.runtimeLifecycleSource,
  );

  const effectiveDrainBudgetMs = disposalBudget.capByRemainingBudget(
    input.dispose.drainingBudgetMs,
  );
  const drainWaitResult = await waitForDrainWithinBudget(
    input.store,
    effectiveDrainBudgetMs,
  );
  const drainWarning = resolveShutdownDrainWarningDecision({
    requestedDrainBudgetMs: input.dispose.drainingBudgetMs,
    effectiveDrainBudgetMs,
    drainWaitResult,
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
  await emitLifecycleEvent(
    input.store,
    input.eventManager,
    globalEvents.drained,
    input.runtimeLifecycleSource,
  );

  await input.disposeAll();
}

export async function disposeRunArtifacts(
  input: DisposeRunArtifactsInput,
): Promise<void> {
  try {
    input.onBeforeStoreDispose();
    await input.store.dispose();
  } finally {
    input.takeUnhookProcessSafetyNets()?.();
    input.takeUnhookShutdown()?.();
  }
}

async function emitLifecycleEvent(
  store: LifecycleStore,
  eventManager: LifecycleEventManager,
  event: (typeof globalEvents)[keyof typeof globalEvents],
  runtimeLifecycleSource: RuntimeCallSource,
): Promise<void> {
  const canonicalId = store.findIdByDefinition(event);
  const registeredEvent = store.findDefinitionById(canonicalId) as IEvent<void>;

  await eventManager.emitLifecycle(registeredEvent, undefined, {
    source: runtimeLifecycleSource,
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

  await new Promise<void>((resolve) => {
    setTimeout(resolve, effectiveCooldownWindowMs);
  });
}

async function waitForDrainWithinBudget(
  store: LifecycleStore,
  effectiveDrainBudgetMs: number,
): Promise<ShutdownDrainWaitResult> {
  if (effectiveDrainBudgetMs <= 0) {
    return { completed: false };
  }

  return {
    completed: true,
    drained: await waitForDisposeDrainBudget(store, effectiveDrainBudgetMs),
  };
}
