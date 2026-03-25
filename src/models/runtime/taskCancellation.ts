import { journal } from "../ExecutionJournal";
import type { ExecutionJournal } from "../../types/executionJournal";
import {
  linkAbortSignals,
  type AbortSignalLink,
} from "../../tools/abortSignals";

/**
 * Per-journal cancellation state for a task execution tree.
 *
 * Nested task calls can forward the same journal while each layer contributes
 * its own caller-provided signal. We therefore keep the raw signal stack plus a
 * current composed link that can be rebuilt whenever a nested layer enters or
 * leaves.
 */
interface TaskCallerSignalState {
  activeSignals: AbortSignal[];
  currentLink: AbortSignalLink;
}

interface ActiveTaskAbortControllerState {
  /**
   * Optional by design.
   *
   * Plain task executions still participate in shutdown drain tracking even
   * when no task-local abort path exists yet. The cooperative abort window only
   * applies once some middleware or runtime path creates a journal-scoped
   * controller.
   */
  controller: AbortController | null;
  retainCount: number;
  register: ((controller: AbortController) => () => void) | null;
  unregister: (() => void) | null;
}

export const taskCancellationJournalKeys = {
  callerSignal: journal.createKey<TaskCallerSignalState>(
    "runner.execution.abortSignal",
  ),
  abortController: journal.createKey<AbortController>(
    "runner.middleware.timeout.abortController",
  ),
  activeAbortController: journal.createKey<ActiveTaskAbortControllerState>(
    "runner.execution.activeAbortController",
  ),
} as const;

/**
 * Lazily initializes the shared caller-signal state for a journal.
 */
function getOrCreateCallerSignalState(
  executionJournal: ExecutionJournal,
): TaskCallerSignalState {
  const existing = executionJournal.get(
    taskCancellationJournalKeys.callerSignal,
  );
  if (existing) {
    return existing;
  }

  const state: TaskCallerSignalState = {
    activeSignals: [],
    currentLink: {
      signal: undefined,
      cleanup() {},
    },
  };
  executionJournal.set(taskCancellationJournalKeys.callerSignal, state);
  return state;
}

/**
 * Rebuilds the composed caller signal after the active signal stack changes.
 *
 * We re-link from scratch instead of trying to mutate listeners incrementally
 * because nested task calls can add/remove the same signal instance in
 * different stack frames, and the full rebuild keeps cleanup deterministic.
 */
function refreshCallerSignalState(state: TaskCallerSignalState): void {
  state.currentLink.cleanup();
  state.currentLink = linkAbortSignals(state.activeSignals);
}

/**
 * Adds a caller-provided signal to the journal-wide cancellation chain.
 *
 * The returned cleanup function must run when that call frame finishes so
 * sibling/nested task executions stop inheriting a signal that no longer
 * belongs to them. Cleanup is idempotent because `finally()` paths may race
 * with error handling.
 */
export function setTaskCallerSignal(
  executionJournal: ExecutionJournal,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) {
    return () => {};
  }

  const state = getOrCreateCallerSignalState(executionJournal);
  state.activeSignals.push(signal);
  refreshCallerSignalState(state);

  return () => {
    const signalIndex = state.activeSignals.lastIndexOf(signal);
    if (signalIndex === -1) {
      return;
    }

    state.activeSignals.splice(signalIndex, 1);
    refreshCallerSignalState(state);
  };
}

/**
 * Returns the timeout middleware's shared abort controller for this journal,
 * creating it on first access so all middleware layers cooperate on the same
 * task-local cancellation path.
 */
export function getOrCreateTaskAbortController(
  executionJournal: ExecutionJournal,
): AbortController {
  const existing = executionJournal.get(
    taskCancellationJournalKeys.abortController,
  );
  if (existing) {
    return existing;
  }

  const controller = new AbortController();
  executionJournal.set(taskCancellationJournalKeys.abortController, controller);
  attachTrackedTaskAbortController(executionJournal, controller);
  return controller;
}

function getOrCreateActiveTaskAbortControllerState(
  executionJournal: ExecutionJournal,
  register: (controller: AbortController) => () => void,
): ActiveTaskAbortControllerState {
  const existing = executionJournal.get(
    taskCancellationJournalKeys.activeAbortController,
  );
  if (existing) {
    existing.register = register;
    return existing;
  }

  const state: ActiveTaskAbortControllerState = {
    // We intentionally do not create an AbortController here.
    // Retaining active task state makes the execution visible to drain
    // accounting, while cooperative shutdown abort remains opt-in for task
    // trees that actually expose a task-local cancellation controller.
    controller:
      executionJournal.get(taskCancellationJournalKeys.abortController) ?? null,
    retainCount: 0,
    register,
    unregister: null,
  };
  executionJournal.set(
    taskCancellationJournalKeys.activeAbortController,
    state,
  );
  return state;
}

function registerTrackedTaskAbortController(
  state: ActiveTaskAbortControllerState,
): void {
  if (!state.controller || !state.register || state.unregister !== null) {
    return;
  }

  state.unregister = state.register(state.controller);
}

/**
 * Retains the journal-scoped task abort controller inside an external active
 * task registry.
 *
 * A forwarded journal may be reused by nested task calls, so registration is
 * reference-counted per journal to avoid duplicate registry entries while still
 * ensuring the controller remains active until the outermost frame completes.
 *
 * This does not force-create a controller for plain tasks. Those executions are
 * still counted by the runtime's drain phase, but the shutdown abort window can
 * only act on task trees that already have a journal-scoped abort controller.
 */
export function retainActiveTaskAbortController(
  executionJournal: ExecutionJournal,
  register: (controller: AbortController) => () => void,
): () => void {
  const state = getOrCreateActiveTaskAbortControllerState(
    executionJournal,
    register,
  );
  if (state.retainCount === 0) {
    registerTrackedTaskAbortController(state);
  }
  state.retainCount += 1;

  return () => releaseActiveTaskAbortController(state);
}

function releaseActiveTaskAbortController(
  state: ActiveTaskAbortControllerState,
): void {
  if (state.retainCount === 0) {
    return;
  }

  state.retainCount -= 1;
  if (state.retainCount > 0) {
    return;
  }

  state.unregister?.();
  state.unregister = null;
}

function attachTrackedTaskAbortController(
  executionJournal: ExecutionJournal,
  controller: AbortController,
): void {
  const state = executionJournal.get(
    taskCancellationJournalKeys.activeAbortController,
  );
  if (!state) {
    return;
  }

  state.controller = controller;
  if (state.retainCount === 0) {
    return;
  }

  // Late controller creation is expected when middleware such as timeout
  // enables task-local cancellation after the task tree is already retained.
  registerTrackedTaskAbortController(state);
}

/**
 * Builds the effective task signal seen by task code and cooperating middleware.
 *
 * This composes caller-provided signals with the task-local abort controller.
 * When neither source exists, tasks intentionally see `undefined` and remain
 * drain-only during shutdown.
 *
 * Callers own the returned link and must invoke `cleanup()` because composing
 * multiple sources may install temporary abort listeners.
 */
export function getTaskAbortSignalLink(
  executionJournal: ExecutionJournal,
): AbortSignalLink {
  const callerSignalState = executionJournal.get(
    taskCancellationJournalKeys.callerSignal,
  );
  return linkAbortSignals([
    callerSignalState?.currentLink.signal,
    executionJournal.get(taskCancellationJournalKeys.abortController)?.signal,
  ]);
}
