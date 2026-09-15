import type { StudioWorkflow } from "./types.js";

export interface WorkflowQuery {
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface WorkflowPage {
  workflows: StudioWorkflow[];
  total: number;
  nextCursor: string | null;
}

/** The registered catalog is immutable; cursors are positions in that registry, not filtered offsets. */
export function workflowPage(
  catalog: StudioWorkflow[],
  query: WorkflowQuery = {},
): WorkflowPage {
  const limit = query.limit ?? 20;
  const start = query.cursor === undefined ? 0 : Number(query.cursor);
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error(
      "Workflow cursor must be a non-negative integer and limit must be between 1 and 100.",
    );
  }
  const needle = (query.query ?? "").trim().toLowerCase();
  const workflows: StudioWorkflow[] = [];
  for (let index = start; index < catalog.length; index++) {
    const workflow = catalog[index];
    if (
      needle &&
      !`${workflow.key} ${workflow.title} ${workflow.category} ${workflow.description}`
        .toLowerCase()
        .includes(needle)
    )
      continue;
    if (workflows.length === limit)
      return { workflows, total: catalog.length, nextCursor: String(index) };
    workflows.push(workflow);
  }
  return { workflows, total: catalog.length, nextCursor: null };
}
