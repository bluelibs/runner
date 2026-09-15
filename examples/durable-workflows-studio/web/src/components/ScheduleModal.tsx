import { useContext, useEffect, useState } from "react";
import { WorkflowApiContext } from "../workflowFeed.js";
import type {
  StudioSchedule,
  StudioWorkflow,
} from "../../../src/shared/types.js";
import { formatDateTime } from "../format.js";
import { JsonEditor, Modal } from "./Modal.js";
import { WorkflowSelect } from "./WorkflowSelect.js";

type Cadence = "interval" | "cron" | "delay";

export function ScheduleModal({
  schedule,
  workflows,
  busy,
  onSave,
  onPreview,
  onClose,
}: {
  schedule?: StudioSchedule;
  workflows: StudioWorkflow[];
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onPreview: (body: Record<string, unknown>) => Promise<string[]>;
  onClose: () => void;
}) {
  const [workflowKey, setWorkflowKey] = useState(
    schedule?.workflowKey ?? workflows[0]?.key ?? "",
  );
  const [workflow, setWorkflow] = useState(workflows.find((item) => item.key === workflowKey));
  const api = useContext(WorkflowApiContext);
  const [workflowError, setWorkflowError] = useState("");
  useEffect(() => {
    if (workflow || !api) return;
    let active = true;
    void api.getWorkflow(workflowKey).then((next) => { if (active) setWorkflow(next); })
      .catch((error: unknown) => { if (active) setWorkflowError(error instanceof Error ? error.message : "Could not load workflow."); });
    return () => { active = false; };
  }, [api, workflowKey, workflow]);
  const [cadence, setCadence] = useState<Cadence>(
    schedule?.type === "cron" ? "cron" : "interval",
  );
  const [cadenceValue, setCadenceValue] = useState(schedule?.pattern ?? "60000");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "UTC");
  const initialInput = schedule?.input ?? workflow?.presets[0]?.payload ?? {};
  const [text, setText] = useState(JSON.stringify(initialInput, null, 2));
  const [parsed, setParsed] = useState<unknown>(initialInput);
  const [valid, setValid] = useState(true);
  const [fires, setFires] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const numericCadence = Number(cadenceValue);
  const cadenceValid =
    cadence === "cron"
      ? cadenceValue.trim().length > 0
      : Number.isFinite(numericCadence) && numericCadence > 0;

  useEffect(() => {
    if (!cadenceValid) {
      setFires([]);
      setPreviewError(null);
      return;
    }
    const body = cadenceBody(cadence, cadenceValue, timezone);
    const timer = window.setTimeout(() => {
      onPreview(body)
        .then((next) => {
          setFires(next);
          setPreviewError(null);
        })
        .catch((error: unknown) => {
          setFires([]);
          setPreviewError(
            error instanceof Error ? error.message : "Invalid cadence.",
          );
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [cadence, cadenceValue, cadenceValid, onPreview, timezone]);

  if (!workflow) return <Modal title="Schedule" subtitle="Loading workflow" onClose={onClose}><p role="status">{workflowError || "Loading workflow…"}</p></Modal>;

  function chooseWorkflow(nextKey: string, next: StudioWorkflow) {
    setWorkflowKey(nextKey);
    setWorkflow(next);
    const nextInput = next?.presets[0]?.payload ?? {};
    setText(JSON.stringify(nextInput, null, 2));
    setParsed(nextInput);
    setValid(true);
  }

  function submit() {
    const body: Record<string, unknown> = {
      input: parsed,
      ...cadenceBody(cadence, cadenceValue, timezone),
    };
    if (!schedule) body.workflow = workflowKey;
    onSave(body);
  }

  return (
    <Modal
      title={schedule ? "Edit schedule" : "New schedule"}
      subtitle={
        schedule
          ? "Update cadence or input without changing schedule identity."
          : "Preview upcoming fires before the schedule goes live."
      }
      onClose={onClose}
    >
      <div className="field-row">
        <div className="field">
          <span className="field-label">Workflow</span>
          <WorkflowSelect
            workflows={workflows}
            value={workflowKey}
            disabled={schedule !== undefined}
            onChange={chooseWorkflow}
          />
        </div>
        <label className="field">
          <span className="field-label">Cadence</span>
          <select
            className="select"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
          >
            <option value="interval">Every N ms</option>
            <option value="cron">Cron</option>
            {!schedule ? <option value="delay">Once after N ms</option> : null}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">
            {cadence === "cron" ? "Cron expression" : "Milliseconds"}
          </span>
          <input
            className="text-input"
            value={cadenceValue}
            placeholder={cadence === "cron" ? "0 2 * * *" : "60000"}
            onChange={(event) => setCadenceValue(event.target.value)}
          />
        </label>
        {cadence === "cron" ? (
          <label className="field">
            <span className="field-label">Timezone</span>
            <input
              className="text-input"
              value={timezone}
              placeholder="UTC"
              onChange={(event) => setTimezone(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="schedule-preview" aria-live="polite">
        <span className="field-label">Next fires · your local time</span>
        {previewError ? <em>{previewError}</em> : null}
        {!previewError && fires.length === 0 ? <em>Enter a valid cadence.</em> : null}
        {fires.map((fire, index) => (
          <span key={fire}><strong>{index + 1}</strong>{formatDateTime(fire)}</span>
        ))}
      </div>
      <div className="field">
        <span className="field-label">Input</span>
        <JsonEditor
          presets={schedule ? [] : workflow.presets}
          value={text}
          validationMessage="Checked against this workflow's runtime input schema before the schedule is saved."
          onChange={(next, nextParsed, nextValid) => {
            setText(next);
            setParsed(nextParsed);
            setValid(nextValid);
          }}
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn primary"
          disabled={!valid || !cadenceValid || previewError !== null || busy}
          onClick={submit}
        >
          {busy ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
        </button>
      </div>
    </Modal>
  );
}

function cadenceBody(
  cadence: Cadence,
  value: string,
  timezone: string,
): Record<string, unknown> {
  if (cadence === "cron") {
    return { cron: value.trim(), ...(timezone.trim() ? { timezone: timezone.trim() } : {}) };
  }
  return { [cadence]: Number(value) };
}
