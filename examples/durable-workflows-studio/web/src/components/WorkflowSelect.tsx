import { useMemo, useState } from "react";
import type { StudioWorkflow } from "../../../src/shared/types.js";
import {
  filterWorkflows,
  WORKFLOW_SEARCH_THRESHOLD,
} from "../workflowCatalog.js";

export function WorkflowSelect({
  workflows,
  value,
  onChange,
  disabled = false,
}: {
  workflows: StudioWorkflow[];
  value: string;
  onChange: (workflowKey: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => filterWorkflows(workflows, query),
    [query, workflows],
  );
  const selected = workflows.find((workflow) => workflow.key === value);
  const options =
    selected && !matches.some((workflow) => workflow.key === selected.key)
      ? [selected, ...matches]
      : matches;
  const searchable = !disabled && workflows.length > WORKFLOW_SEARCH_THRESHOLD;

  return (
    <div className="workflow-picker">
      {searchable ? (
        <label className="workflow-picker-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${workflows.length} workflows…`}
            aria-label="Search workflows"
          />
          <em>{matches.length}</em>
        </label>
      ) : null}
      <select
        className="select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((workflow) => (
          <option key={workflow.key} value={workflow.key}>
            {workflow.title} · {workflow.category}
          </option>
        ))}
      </select>
      {searchable && matches.length === 0 ? (
        <span className="field-hint workflow-picker-empty">
          No workflow matches. Refine the search.
        </span>
      ) : null}
    </div>
  );
}
