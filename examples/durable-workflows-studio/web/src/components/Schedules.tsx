import { useEffect, useMemo, useState } from "react";
import type {
  StudioSchedule,
  StudioWorkflow,
} from "../../../src/shared/types.js";
import { formatDateTime } from "../format.js";
import { ScheduleModal } from "./ScheduleModal.js";

export function Schedules({
  schedules,
  workflows,
  busy,
  now: _now,
  onCreate,
  onUpdate,
  onPreview,
  onPause,
  onResume,
  onRemove,
}: {
  schedules: StudioSchedule[];
  workflows: StudioWorkflow[];
  busy: boolean;
  now: number;
  onCreate: (body: Record<string, unknown>) => void;
  onUpdate: (id: string, body: Record<string, unknown>) => void;
  onPreview: (body: Record<string, unknown>) => Promise<string[]>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StudioSchedule | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(40);
  void _now;
  const statuses = useMemo(
    () => [...new Set(schedules.map((schedule) => schedule.status))].sort(),
    [schedules],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return schedules.filter((schedule) => {
      if (status !== "all" && schedule.status !== status) return false;
      if (needle === "") return true;
      return [
        schedule.id,
        schedule.workflowKey,
        schedule.workflowTitle,
        schedule.type,
        schedule.pattern,
        schedule.status,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [query, schedules, status]);
  const visible = filtered.slice(0, visibleLimit);
  const showScaleTools = schedules.length > 5;

  useEffect(() => setVisibleLimit(40), [query, schedules.length, status]);

  return (
    <div className="schedules">
      <div className="schedules-head">
        <div>
          <h2>Schedules</h2>
          <p className="muted">
            Cron, interval and one-time timers that start workflows on their own.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={workflows.length === 0}
          onClick={() => setCreating(true)}
        >
          New schedule
        </button>
      </div>
      {showScaleTools ? (
        <div className="schedule-toolbar">
          <label className="schedule-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${schedules.length} schedules…`}
              aria-label="Search schedules"
            />
          </label>
          <select
            className="overview-select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter schedules by status"
          >
            <option value="all">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <span className="schedule-result-count">
            {visible.length} of {filtered.length}
          </span>
        </div>
      ) : null}
      {schedules.length === 0 ? (
        <div className="empty-list">
          <p className="empty-title">No schedules</p>
          <p className="empty-sub">
            Schedules fire workflows without anyone pressing start.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-list">
          <p className="empty-title">No matching schedules</p>
          <p className="empty-sub">Try a broader search or another status.</p>
        </div>
      ) : (
        <>
          <ul className="schedule-list">
            {visible.map((schedule) => (
            <li key={schedule.id} className="schedule-row">
              <div className="schedule-main">
                <span className="schedule-id">
                  <code>{schedule.id}</code>
                </span>
                <span className="schedule-sub">
                  {schedule.workflowTitle} · {schedule.type}{" "}
                  <code>{schedule.pattern}</code>
                </span>
                <span className="schedule-times">
                  next {formatDateTime(schedule.nextRun)} · last{" "}
                  {formatDateTime(schedule.lastRun)}
                </span>
              </div>
              <span
                className={`tag tone-${schedule.status === "active" ? "success" : "neutral"}`}
              >
                {schedule.status}
              </span>
              <div className="schedule-actions">
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busy}
                  onClick={() => setEditing(schedule)}
                >
                  Edit
                </button>
                {schedule.status === "active" ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={busy}
                    onClick={() => onPause(schedule.id)}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={busy}
                    onClick={() => onResume(schedule.id)}
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  className="btn small danger-ghost"
                  disabled={busy}
                  onClick={() => onRemove(schedule.id)}
                >
                  Delete
                </button>
              </div>
            </li>
            ))}
          </ul>
          {visible.length < filtered.length ? (
            <div className="schedule-load-more">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setVisibleLimit((current) => current + 40)}
              >
                Show {Math.min(40, filtered.length - visible.length)} more schedules
              </button>
            </div>
          ) : null}
        </>
      )}
      {creating ? (
        <ScheduleModal
          workflows={workflows}
          busy={busy}
          onPreview={onPreview}
          onSave={(body) => {
            onCreate(body);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <ScheduleModal
          schedule={editing}
          workflows={workflows}
          busy={busy}
          onPreview={onPreview}
          onSave={(body) => {
            onUpdate(editing.id, body);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
