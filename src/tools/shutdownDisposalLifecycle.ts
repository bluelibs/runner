import { IEvent, IEventEmissionCallOptions, RegisterableItem } from "../defs";
import { globalEvents } from "../globals/globalEvents";
import { Logger } from "../models/Logger";
import { RuntimeCallSource } from "../types/runtimeSource";
import { createDisposalBudget } from "./disposalBudget";
import { waitForDisposeDrainBudget } from "./processShutdownHooks";
import {
  resolveShutdownDrainWarningDecision,
  ShutdownDrainWaitResult,
} from "./shutdownDrainWarning";
import { ForceDisposalController } from "./ForceDisposalController";
import { runtimeShutdownAbortReason } from "./runtimeShutdownAbortReason";

type LifecycleStore = {
  beginCoolingDown(): void;
  beginDisposing(): void;
  beginAborting(): void;
  cooldown(options?: { shouldStop?: () => boolean }): Promise<void>;
  beginDrained(): void;
  waitForDrain(timeoutMs: number): Promise<boolean>;
  abortInFlightTaskSignals(reason: string): void;
  resolveRegisteredDefinition<TDefinition extends RegisterableItem>(
    definition: TDefinition,
  ): TDefinition;
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
    abortWindowMs: number;
    cooldownWindowMs: number;
  };
  forceDisposal: ForceDisposalController;
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
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  input.store.beginCoolingDown();

  await input.store.cooldown({
    shouldStop: () => input.forceDisposal.isRequested,
  });
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  await waitForCooldownWindow(
    disposalBudget,
    input.dispose.cooldownWindowMs,
    input.forceDisposal,
  );
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  // Freeze admissions only after all cooldown hooks had a chance to stop ingress
  // and register any shutdown-specific source allowances.
  input.store.beginDisposing();
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  await emitLifecycleEvent(
    input.store,
    input.eventManager,
    globalEvents.disposing,
    input.runtimeLifecycleSource,
  );
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  const effectiveDrainBudgetMs = disposalBudget.capByRemainingBudget(
    input.dispose.drainingBudgetMs,
  );
  const drainWaitResult = await waitForDrainWithinBudget(
    input.store,
    effectiveDrainBudgetMs,
  );
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  let effectiveAbortWindowMs = 0;
  let abortWaitResult: ShutdownDrainWaitResult = { completed: false };

  if (drainWaitResult.completed && drainWaitResult.drained === false) {
    input.store.beginAborting();
    await emitLifecycleEvent(
      input.store,
      input.eventManager,
      globalEvents.aborting,
      input.runtimeLifecycleSource,
    );

    input.store.abortInFlightTaskSignals(runtimeShutdownAbortReason);
    if (input.forceDisposal.isRequested) {
      await disposeImmediately(input);
      return;
    }

    effectiveAbortWindowMs = disposalBudget.capByRemainingBudget(
      input.dispose.abortWindowMs,
    );
    if (effectiveAbortWindowMs > 0) {
      abortWaitResult = await waitForDrainWithinBudget(
        input.store,
        effectiveAbortWindowMs,
      );
      if (input.forceDisposal.isRequested) {
        await disposeImmediately(input);
        return;
      }
    }
  }

  const drainWarning = resolveShutdownDrainWarningDecision({
    requestedDrainBudgetMs: input.dispose.drainingBudgetMs,
    effectiveDrainBudgetMs,
    drainWaitResult,
    requestedAbortWindowMs: input.dispose.abortWindowMs,
    effectiveAbortWindowMs,
    abortWaitResult,
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
            requestedAbortWindowMs: input.dispose.abortWindowMs,
            effectiveAbortWindowMs,
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
  if (input.forceDisposal.isRequested) {
    await disposeImmediately(input);
    return;
  }

  await input.disposeAll();
}

export async function disposeRunArtifacts(
  input: DisposeRunArtifactsInput,
): Promise<void> {
  try {
    input.onBeforeStoreDispose();
    await input.store.dispose();
  } finally {
    // Safety nets and shutdown hooks must be released even if store disposal
    // fails, otherwise a broken shutdown can leave process-level observers
    // hanging around and interfering with later runs.
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
  const registeredEvent = store.resolveRegisteredDefinition(
    event,
  ) as IEvent<void>;

  await eventManager.emitLifecycle(registeredEvent, undefined, {
    source: runtimeLifecycleSource,
    throwOnError: false,
    failureMode: "aggregate",
  });
}

async function waitForCooldownWindow(
  disposalBudget: ReturnType<typeof createDisposalBudget>,
  cooldownWindowMs: number,
  forceDisposal: ForceDisposalController,
): Promise<void> {
  const effectiveCooldownWindowMs =
    disposalBudget.capByRemainingBudget(cooldownWindowMs);
  if (effectiveCooldownWindowMs <= 0 || forceDisposal.isRequested) {
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, effectiveCooldownWindowMs);

    void forceDisposal.whenRequested.then(finish);
  });
}

async function waitForDrainWithinBudget(
  store: LifecycleStore,
  effectiveDrainBudgetMs: number,
): Promise<ShutdownDrainWaitResult> {
  if (effectiveDrainBudgetMs <= 0) {
    return {
      completed: true,
      drained: await waitForDisposeDrainBudget(store, 0),
    };
  }

  return {
    completed: true,
    drained: await waitForDisposeDrainBudget(store, effectiveDrainBudgetMs),
  };
}

async function disposeImmediately(
  input: ShutdownDisposalLifecycleInput,
): Promise<void> {
  input.store.beginDisposing();
  await input.disposeAll();
}
