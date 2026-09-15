import { describe, expect, it } from "vitest";
import type { StudioExecutionSummary } from "../../src/shared/types.js";
import { mergeExecutions } from "./executionFeed.js";

function execution(
  id: string,
  createdAt: string,
  status: StudioExecutionSummary["status"] = "running",
): StudioExecutionSummary {
  return {
    id,
    workflowKey: "workflow",
    workflowTitle: "Workflow",
    status,
    attempt: 1,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    position: null,
  };
}

describe("execution feed", () => {
  it("deduplicates refreshed pages, updates rows and preserves newest order", () => {
    const older = execution("older", "2026-09-14T10:00:00.000Z");
    const current = execution("current", "2026-09-14T11:00:00.000Z");
    const updated = { ...current, status: "completed" as const };
    const newest = execution("newest", "2026-09-14T12:00:00.000Z");

    expect(mergeExecutions([current, older], [newest, updated])).toEqual([
      newest,
      updated,
      older,
    ]);
  });

  it("uses execution identity to stabilize equal timestamps", () => {
    const at = "2026-09-14T12:00:00.000Z";
    expect(mergeExecutions([], [execution("a", at), execution("b", at)]))
      .toEqual([execution("a", at), execution("b", at)]);
  });
});
