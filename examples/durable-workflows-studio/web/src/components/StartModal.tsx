import { useState } from "react";
import type { StudioWorkflow } from "../../../src/shared/types.js";
import { JsonEditor, Modal } from "./Modal.js";
import { WorkflowSelect } from "./WorkflowSelect.js";

export function StartModal({
  workflows,
  initialWorkflow,
  busy,
  onStart,
  onClose,
}: {
  workflows: StudioWorkflow[];
  initialWorkflow: string | null;
  busy: boolean;
  onStart: (workflow: string, input: unknown) => void;
  onClose: () => void;
}) {
  const first = workflows.find((w) => w.key === initialWorkflow) ?? workflows[0];
  const [workflowKey, setWorkflowKey] = useState(first?.key ?? "");
  const workflow = workflows.find((w) => w.key === workflowKey) ?? first;
  const [text, setText] = useState(
    JSON.stringify(workflow?.presets[0]?.payload ?? {}, null, 2),
  );
  const [parsed, setParsed] = useState<unknown>(
    workflow?.presets[0]?.payload ?? {},
  );
  const [valid, setValid] = useState(true);

  if (!first || !workflow) return null;

  function pickWorkflow(key: string) {
    setWorkflowKey(key);
    const next = workflows.find((w) => w.key === key)!;
    const payload = JSON.stringify(next.presets[0]?.payload ?? {}, null, 2);
    setText(payload);
    setParsed(next.presets[0]?.payload ?? {});
    setValid(true);
  }

  return (
    <Modal
      title="Start execution"
      subtitle="Pick a workflow and shape its input."
      onClose={onClose}
    >
      <div className="field">
        <span className="field-label">Workflow</span>
        <WorkflowSelect
          workflows={workflows}
          value={workflowKey}
          onChange={pickWorkflow}
        />
      </div>
      <p className="field-hint">{workflow.description}</p>
      <div className="field">
        <span className="field-label">Input</span>
        <JsonEditor
          presets={workflow.presets}
          value={text}
          validationMessage="Checked against this workflow's runtime input schema before a run is created."
          onChange={(next, nextParsed, nextValid) => {
            setText(next);
            setParsed(nextParsed);
            setValid(nextValid);
          }}
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!valid || busy}
          onClick={() => onStart(workflowKey, parsed)}
        >
          {busy ? "Starting…" : "Start execution"}
        </button>
      </div>
    </Modal>
  );
}
