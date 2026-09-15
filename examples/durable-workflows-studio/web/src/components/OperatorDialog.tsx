import { useMemo, useState } from "react";
import type { StudioExecutionDetail } from "../../../src/shared/types.js";
import { JsonEditor, Modal } from "./Modal.js";

export type OperatorAction = "skip" | "edit";

export function OperatorDialog({
  action,
  detail,
  busy,
  onSubmit,
  onClose,
}: {
  action: OperatorAction;
  detail: StudioExecutionDetail;
  busy: boolean;
  onSubmit: (stepId: string, reason: string, result?: unknown) => void;
  onClose: () => void;
}) {
  const firstStep =
    detail.timeline.find((node) => node.state === "active" || node.state === "waiting") ??
    detail.timeline[0];
  const [stepId, setStepId] = useState(firstStep?.id ?? "");
  const selected = detail.timeline.find((node) => node.id === stepId);
  const initialText = useMemo(
    () => JSON.stringify(selected?.result ?? {}, null, 2),
    [selected?.id],
  );
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<unknown>(selected?.result ?? {});
  const [valid, setValid] = useState(true);
  const [reason, setReason] = useState("");

  function chooseStep(nextStepId: string) {
    setStepId(nextStepId);
    const node = detail.timeline.find((item) => item.id === nextStepId);
    const nextText = JSON.stringify(node?.result ?? {}, null, 2);
    setText(nextText);
    setResult(node?.result ?? {});
    setValid(true);
  }

  const title = action === "skip" ? "Skip durable step" : "Edit step state";
  const subtitle =
    action === "skip"
      ? "Mark a step complete manually. The reason is written to the audit trail."
      : "Replace a persisted result. Review downstream assumptions before saving.";

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <label className="field">
        <span className="field-label">Step</span>
        <select
          className="select"
          value={stepId}
          onChange={(event) => chooseStep(event.target.value)}
        >
          {detail.timeline.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label} · {node.id} · {node.state}
            </option>
          ))}
        </select>
      </label>
      {action === "edit" ? (
        <div className="field">
          <span className="field-label">Replacement result</span>
          <JsonEditor
            presets={[]}
            value={text}
            onChange={(next, nextResult, nextValid) => {
              setText(next);
              setResult(nextResult);
              setValid(nextValid);
            }}
          />
        </div>
      ) : null}
      <label className="field">
        <span className="field-label">Audit reason</span>
        <input
          className="text-input"
          value={reason}
          autoFocus={action === "skip"}
          placeholder="What happened, and why is this safe?"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || stepId === "" || reason.trim() === "" || !valid}
          onClick={() => onSubmit(stepId, reason.trim(), result)}
        >
          {busy ? "Applying…" : action === "skip" ? "Confirm skip" : "Save state"}
        </button>
      </div>
    </Modal>
  );
}
