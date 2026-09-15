import { useState } from "react";

function stringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function JsonView({
  value,
  collapsed = false,
  label,
}: {
  value: unknown;
  collapsed?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [copied, setCopied] = useState(false);
  const text = stringify(value);
  const preview =
    text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (file:// demo) — selection still works.
    }
  }

  return (
    <div className="json-view">
      <div className="json-head">
        <button
          type="button"
          className="json-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className={`caret${open ? " open" : ""}`}>▸</span>
          {label ?? "payload"}
        </button>
        <button type="button" className="mini-btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="json-body">{open ? text : preview}</pre>
    </div>
  );
}
