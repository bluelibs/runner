export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast kind-${toast.kind}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
