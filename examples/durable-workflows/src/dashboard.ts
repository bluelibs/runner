/**
 * Dashboard Section — payload-free execution states with cursor pagination.
 *
 * Status pages use `operator.getExecutionState()` and
 * `operator.listExecutionStates()` instead of the raw `getExecutionDetail()`
 * path, so routine display never touches workflow inputs, results, or error
 * payloads. Listing uses keyset cursors (not offsets), so pages stay stable
 * while new executions are created concurrently.
 */
import type {
  DurableExecutionState,
  DurableResource,
} from "@bluelibs/runner/node";

function renderStateLine(state: DurableExecutionState): string {
  const position = state.current
    ? `${state.current.kind}:${state.current.stepId}`
    : "—";
  return (
    `${state.id} ${state.workflowKey} ${state.status} ` +
    `attempt ${state.attempt}/${state.maxAttempts} at ${position}`
  );
}

/**
 * Pages every execution state with keyset cursors and prints one line each.
 * Page markers make the cursor walk visible. Returns rendered page counts.
 */
export async function runDashboardSection(
  durable: DurableResource,
  options?: { limit?: number },
): Promise<{ rendered: number; pages: number }> {
  const limit = options?.limit ?? 100;
  let cursor: string | undefined;
  let rendered = 0;
  let pages = 0;
  do {
    const page = await durable.operator.listExecutionStates({ limit, cursor });
    pages += 1;
    console.log(`  -- page ${pages} (${page.states.length} states) --`);
    for (const state of page.states) {
      console.log(`  ${renderStateLine(state)}`);
      rendered += 1;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { rendered, pages };
}

/** Prints the dashboard-safe summary of a single execution. */
export async function renderExecutionState(
  durable: DurableResource,
  executionId: string,
): Promise<void> {
  const state = await durable.operator.getExecutionState(executionId);
  console.log(`  ${state ? renderStateLine(state) : "execution not found"}`);
}
