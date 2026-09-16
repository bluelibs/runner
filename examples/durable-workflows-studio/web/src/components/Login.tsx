import { useState } from "react";

export function LoginScreen({
  demo,
  onLogin,
}: {
  demo: boolean;
  /** Returns an error message to display, or null on success. */
  onLogin: (token: string) => Promise<string | null>;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  async function submit() {
    const value = token.trim();
    if (busy || value === "") return;
    setBusy(true);
    try {
      const failure = await onLogin(value);
      if (failure) {
        setError(failure);
        setShakeKey((key) => key + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div
        className={`login-card${error ? " login-shake" : ""}`}
        key={shakeKey}
        role="dialog"
        aria-modal="true"
        aria-label="Studio login"
      >
        <span className="brand-mark login-mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 32 32">
            <rect x="4" y="4" width="10" height="10" rx="2.5" fill="#5e6ad2" />
            <rect x="18" y="4" width="10" height="10" rx="5" fill="#38bdf8" />
            <rect x="4" y="18" width="10" height="10" rx="5" fill="#34d399" />
            <rect x="18" y="18" width="10" height="10" rx="2.5" fill="#f59e0b" />
          </svg>
        </span>
        <h1>Durable Studio</h1>
        <p className="login-sub">
          This studio is locked. Enter the admin token to continue.
        </p>
        <label className="field">
          <span className="field-label">Admin token</span>
          <input
            className="text-input"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="••••••••"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </label>
        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}
        {demo ? (
          <p className="login-hint">
            Demo build — the token is <code>admin</code>.
          </p>
        ) : null}
        <button
          type="button"
          className="btn primary full"
          disabled={busy || token.trim() === ""}
          onClick={() => void submit()}
        >
          {busy ? "Unlocking…" : "Unlock studio"}
        </button>
      </div>
    </div>
  );
}
