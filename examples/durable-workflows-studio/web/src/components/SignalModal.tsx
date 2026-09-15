import { useState } from "react";
import type { StudioSignal } from "../../../src/shared/types.js";
import { JsonEditor, Modal } from "./Modal.js";

function defaultPayload(signal: StudioSignal): string {
  const preset = signal.presets[0]?.payload ?? {};
  return JSON.stringify(preset, null, 2);
}

export function SignalModal({
  signals,
  initialSignal,
  busy,
  onSend,
  onClose,
}: {
  signals: StudioSignal[];
  initialSignal?: string;
  busy: boolean;
  onSend: (signal: string, payload: unknown) => void;
  onClose: () => void;
}) {
  const first =
    signals.find((s) => s.id === initialSignal) ?? signals[0];
  const [signalId, setSignalId] = useState(first?.id ?? "");
  const signal = signals.find((s) => s.id === signalId) ?? first;
  const [text, setText] = useState(
    signal ? defaultPayload(signal) : "{}",
  );
  const [parsed, setParsed] = useState<unknown>(
    signal?.presets[0]?.payload ?? {},
  );
  const [valid, setValid] = useState(true);

  if (!first || !signal) return null;

  function pickSignal(id: string) {
    setSignalId(id);
    const next = signals.find((s) => s.id === id)!;
    setText(defaultPayload(next));
    setParsed(next.presets[0]?.payload ?? {});
    setValid(true);
  }

  return (
    <Modal
      title="Send signal"
      subtitle="Deliver an event to the waiting execution."
      onClose={onClose}
    >
      <label className="field">
        <span className="field-label">Signal</span>
        <select
          className="select"
          value={signalId}
          onChange={(event) => pickSignal(event.target.value)}
        >
          {signals.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.id}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">{signal.description}</p>
      <div className="field">
        <span className="field-label">Payload</span>
        <JsonEditor
          presets={signal.presets}
          value={text}
          validationMessage="Checked against this signal's runtime payload schema before delivery."
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
          onClick={() => onSend(signalId, parsed)}
        >
          {busy ? "Sending…" : "Send signal"}
        </button>
      </div>
    </Modal>
  );
}
