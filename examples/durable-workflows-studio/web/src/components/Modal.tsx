import { useEffect, useState, type ReactNode } from "react";
import type { StudioInputPreset } from "../../../src/shared/types.js";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="modal-sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Back
        </button>
        <button
          type="button"
          className={`btn${danger ? " danger" : " primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Preset picker + JSON editor with inline validation. */
export function JsonEditor({
  presets,
  value,
  validationMessage,
  onChange,
}: {
  presets: StudioInputPreset[];
  value: string;
  validationMessage?: string;
  onChange: (value: string, parsed: unknown, valid: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function apply(text: string) {
    try {
      const parsed: unknown = text.trim() === "" ? {} : JSON.parse(text);
      setError(null);
      onChange(text, parsed, true);
    } catch {
      setError("Invalid JSON — fix the syntax to continue.");
      onChange(text, undefined, false);
    }
  }

  return (
    <div className="json-editor">
      {validationMessage ? (
        <div className="schema-note">
          <span className="schema-note-mark" aria-hidden="true">
            ✓
          </span>
          <span>{validationMessage}</span>
        </div>
      ) : null}
      {presets.length > 0 ? (
        <div className="preset-group">
          <span className="preset-label">Load an example</span>
          <div className="preset-row">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="chip-btn"
                onClick={() => apply(JSON.stringify(preset.payload, null, 2))}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <textarea
        className="json-input"
        spellCheck={false}
        value={value}
        onChange={(event) => apply(event.target.value)}
        rows={10}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function ReasonDialog({
  title,
  message,
  confirmLabel,
  placeholder,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  placeholder: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={title} subtitle={message} onClose={onClose}>
      <label className="field">
        <span className="field-label">Reason</span>
        <input
          className="text-input"
          value={reason}
          autoFocus
          placeholder={placeholder}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && reason.trim() !== "") {
              onConfirm(reason.trim());
            }
          }}
        />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={reason.trim() === ""}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
