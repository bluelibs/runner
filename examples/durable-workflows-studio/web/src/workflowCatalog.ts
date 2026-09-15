import type { StudioWorkflow } from "../../src/shared/types.js";

export const WORKFLOW_SEARCH_THRESHOLD = 5;

export function filterWorkflows(
  workflows: StudioWorkflow[],
  query: string,
): StudioWorkflow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return workflows;
  return workflows.filter((workflow) =>
    [
      workflow.title,
      workflow.key,
      workflow.category,
      workflow.description,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
}
