import type {
  StudioGraphEdge,
  StudioNodeKind,
  StudioTimelineNode,
} from "../../../src/shared/types.js";
import { formatClock, formatCountdown } from "../format.js";
import { JsonView } from "./JsonView.js";
import { NodeStateTag } from "./StatusPill.js";

function KindIcon({ kind }: { kind: StudioNodeKind }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "signal":
      return (
        <svg {...props}>
          <path d="M8 2a4 4 0 0 1 4 4c0 3 1 4 1 4H3s1-1 1-4a4 4 0 0 1 4-4Z" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
        </svg>
      );
    case "sleep":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" />
        </svg>
      );
    case "switch":
      return (
        <svg {...props}>
          <circle cx="4" cy="4" r="1.6" />
          <circle cx="4" cy="12" r="1.6" />
          <circle cx="12" cy="8" r="1.6" />
          <path d="M5.5 4.5 10.5 7.5M5.5 11.5l5-3" />
        </svg>
      );
    case "child":
      return (
        <svg {...props}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M2.5 6.5h11" />
        </svg>
      );
    case "note":
      return (
        <svg {...props}>
          <path d="M4 2.5h6l2 2v9H4Z" />
          <path d="M10 2.5v2h2M6 8h4M6 10.5h4" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M5.5 8.2 7.3 10l3.2-3.6" />
        </svg>
      );
  }
}

function branchOf(nodeId: string, edges: StudioGraphEdge[]): string | null {
  const incoming = edges.find(
    (edge) => edge.to === nodeId && edge.branch !== undefined,
  );
  return incoming?.branch ?? incoming?.label ?? null;
}

export function Timeline({
  nodes,
  edges,
  now,
  onSignal,
}: {
  nodes: StudioTimelineNode[];
  edges: StudioGraphEdge[];
  now: number;
  onSignal: (signalId: string) => void;
}) {
  return (
    <ol className="timeline">
      {nodes.map((node, index) => {
        const last = index === nodes.length - 1;
        const branch = branchOf(node.id, edges);
        const countdownTarget =
          node.wait?.timeoutAtMs ?? node.wait?.fireAtMs ?? null;
        return (
          <li key={node.id} className={`tl-node state-${node.state}`}>
            <div className="tl-rail" aria-hidden="true">
              <span className="tl-dot">
                <KindIcon kind={node.kind} />
              </span>
              {!last ? <span className="tl-line" /> : null}
            </div>
            <div className="tl-card">
              <div className="tl-top">
                <span className="tl-label">{node.label}</span>
                <NodeStateTag state={node.state} />
              </div>
              <p className="tl-desc">{node.description}</p>
              <div className="tl-meta">
                <code className="tl-id">{node.id}</code>
                {branch ? <span className="branch-chip">{branch}</span> : null}
                {node.branchTaken ? (
                  <span className="branch-chip taken">→ {node.branchTaken}</span>
                ) : null}
                {node.completedAt ? (
                  <span className="tl-time">{formatClock(node.completedAt)}</span>
                ) : null}
              </div>
              {node.state === "waiting" && countdownTarget !== null ? (
                <p className="tl-wait">
                  {node.wait?.signalId ? "times out in " : "fires in "}
                  <strong>{formatCountdown(countdownTarget, now)}</strong>
                </p>
              ) : null}
              {node.state === "waiting" && node.wait?.signalId ? (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => onSignal(node.wait!.signalId!)}
                >
                  Send {node.wait.signalId}
                </button>
              ) : null}
              {node.result !== null && node.result !== undefined ? (
                <JsonView value={node.result} collapsed label="result" />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
