import { useRef, useState } from "react";
import { useWorkflowFeed } from "../workflowFeed.js";
import type { StudioWorkflow } from "../../../src/shared/types.js";
import { WORKFLOW_SEARCH_THRESHOLD } from "../workflowCatalog.js";

export function WorkflowSelect({
  workflows,
  value,
  onChange,
  disabled = false,
  onClear,
  compact = false,
}: {
  workflows: StudioWorkflow[];
  value: string;
  onChange: (workflowKey: string, workflow: StudioWorkflow) => void;
  disabled?: boolean;
  onClear?: () => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const disclosure = useRef<HTMLDetailsElement>(null);
  const feed = useWorkflowFeed(workflows, query);
  const matches = feed.workflows;
  const selected = workflows.find((workflow) => workflow.key === value);
  const options =
    selected && !matches.some((workflow) => workflow.key === selected.key)
      ? [selected, ...matches]
      : matches;
  const searchable = !disabled && feed.total > WORKFLOW_SEARCH_THRESHOLD;

  const picker = (
    <div className="workflow-picker">
      {searchable ? (
        <label className="workflow-picker-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${feed.total} workflows…`}
            aria-label="Search workflows"
          />
          <em>{matches.length}</em>
        </label>
      ) : null}
      <select
        className="select"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (disclosure.current) disclosure.current.open = false;
          if (!event.target.value) {
            onClear?.();
            return;
          }
          const workflow = options.find(
            (item) => item.key === event.target.value,
          );
          if (workflow) onChange(workflow.key, workflow);
        }}
      >
        {onClear ? <option value="">All workflows</option> : null}
        {options.map((workflow) => (
          <option key={workflow.key} value={workflow.key}>
            {workflow.title} · {workflow.category}
          </option>
        ))}
      </select>
      {feed.offset > 0 ? (
        <button
          type="button"
          className="load-more-btn"
          disabled={feed.loading}
          onClick={feed.loadPrevious}
        >
          Load previous workflows
        </button>
      ) : null}
      {feed.nextCursor ? (
        <button
          type="button"
          className="load-more-btn"
          disabled={feed.loading}
          onClick={feed.loadMore}
        >
          Show more workflows
        </button>
      ) : null}
      {feed.error ? (
        <button type="button" className="load-more-btn" onClick={feed.retry}>
          {feed.error} Retry
        </button>
      ) : null}
      {searchable && matches.length === 0 ? (
        <span className="field-hint workflow-picker-empty">
          No workflow matches. Refine the search.
        </span>
      ) : null}
    </div>
  );
  return compact ? (
    <details className="workflow-disclosure" ref={disclosure}>
      <summary aria-label="Filter by workflow">
        {selected?.title ?? "All workflows"}
      </summary>
      {picker}
    </details>
  ) : (
    picker
  );
}
