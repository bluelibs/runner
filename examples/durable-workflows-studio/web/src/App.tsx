import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioExecutionDetail,
  StudioExecutionSummary,
  StudioSchedule,
  StudioWorkflow,
} from "../../src/shared/types.js";
import { EXECUTION_STATUS_META, isLiveStatus } from "../../src/shared/statuses.js";
import {
  ApiError,
  clearStoredToken,
  createLiveApi,
  getStoredToken,
  setStoredToken,
  type StudioApi,
} from "./api.js";
import { createDemoApi } from "./demo.js";
import { useExecutionFeed } from "./executionFeed.js";
import { ExecutionDetail } from "./components/ExecutionDetail.js";
import { ExecutionList } from "./components/ExecutionList.js";
import { LoginScreen } from "./components/Login.js";
import { ConfirmDialog, Modal, ReasonDialog } from "./components/Modal.js";
import { Overview } from "./components/Overview.js";
import {
  OperatorDialog,
  type OperatorAction,
} from "./components/OperatorDialog.js";
import { Schedules } from "./components/Schedules.js";
import { Sidebar, type StudioView } from "./components/Sidebar.js";
import { SignalModal } from "./components/SignalModal.js";
import { StartModal } from "./components/StartModal.js";
import { Toasts, type Toast } from "./components/Toasts.js";

type StatusFilter = "all" | "live" | "sleeping" | "failed" | "completed" | "cancelled";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "sleeping", label: "Sleeping" },
  { id: "failed", label: "Failed" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

function readParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

const PARAMS = readParams();
const DEMO = PARAMS.has("demo");
const DEMO_AUTH = PARAMS.has("auth");

function initialView(): StudioView {
  const requested = PARAMS.get("view");
  if (requested === "schedules" || requested === "executions") return requested;
  if (PARAMS.has("select") || PARAMS.has("modal")) return "executions";
  return "overview";
}

export function App() {
  const [api, setApi] = useState<StudioApi>(() =>
    DEMO
      ? createDemoApi(DEMO_AUTH ? { locked: true } : undefined)
      : createLiveApi("", { getToken: getStoredToken }),
  );
  const [locked, setLocked] = useState(() => DEMO && DEMO_AUTH);
  const [authRequired, setAuthRequired] = useState(() => DEMO && DEMO_AUTH);
  const [workflows, setWorkflows] = useState<StudioWorkflow[]>([]);
  const [schedules, setSchedules] = useState<StudioSchedule[]>([]);
  const [stuck, setStuck] = useState<StudioExecutionSummary[]>([]);
  const [view, setView] = useState<StudioView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(() => PARAMS.get("select"));
  const [detail, setDetail] = useState<StudioExecutionDetail | null>(null);
  const [workflowFilter, setWorkflowFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(() => PARAMS.get("modal") === "start");
  const [signalling, setSignalling] = useState(() => PARAMS.get("modal") === "signal");
  const [signalPreset, setSignalPreset] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<"cancel" | "retry" | "force-fail" | null>(null);
  const [operatorAction, setOperatorAction] = useState<OperatorAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const overviewSearchRef = useRef<HTMLInputElement>(null);
  const toastSequence = useRef(0);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    toastSequence.current += 1;
    const id = toastSequence.current;
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const noteUnauthorized = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) {
      setAuthRequired(true);
      setLocked(true);
      return true;
    }
    return false;
  }, []);
  const handleFeedError = useCallback(
    (error: unknown) => {
      if (noteUnauthorized(error)) return;
      if (!DEMO) setOffline(true);
    },
    [noteUnauthorized],
  );
  const executionFeed = useExecutionFeed({
    api,
    paused: locked,
    onError: handleFeedError,
  });
  const executions = executionFeed.executions;

  const refreshAuxiliaryLists = useCallback(async () => {
    const [nextSchedules, nextStuck] = await Promise.all([
      api.listSchedules(),
      api.listStuck(),
    ]);
    setSchedules(nextSchedules);
    setStuck(nextStuck);
    setRefreshedAt(Date.now());
    setOffline(false);
  }, [api]);

  const refreshLists = useCallback(async () => {
    await Promise.all([
      executionFeed.refreshHead(),
      refreshAuxiliaryLists(),
    ]);
  }, [executionFeed.refreshHead, refreshAuxiliaryLists]);

  const previewSchedule = useCallback(
    (body: Record<string, unknown>) => api.previewSchedule(body),
    [api],
  );

  useEffect(() => {
    if (locked) return;
    let mounted = true;
    api
      .listWorkflows()
      .then((next) => {
        if (mounted) setWorkflows(next);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        if (noteUnauthorized(error)) return;
        if (!DEMO) setOffline(true);
      });
    refreshAuxiliaryLists().catch((error: unknown) => {
      if (!mounted) return;
      if (noteUnauthorized(error)) return;
      if (!DEMO) setOffline(true);
    });
    const timer = window.setInterval(() => {
      refreshAuxiliaryLists().catch((error: unknown) => {
        noteUnauthorized(error);
      });
    }, 2500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [api, locked, noteUnauthorized, refreshAuxiliaryLists]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId || locked) {
      if (!selectedId) setDetail(null);
      return;
    }
    return api.subscribeExecution(selectedId, setDetail);
  }, [api, selectedId, locked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (starting || signalling || confirming || operatorAction || locked) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        if (view === "overview") overviewSearchRef.current?.focus();
        else searchRef.current?.focus();
      } else if (event.key === "n") {
        setStarting(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [starting, signalling, confirming, operatorAction, locked, view]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return executions.filter((execution) => {
      if (workflowFilter && execution.workflowKey !== workflowFilter) return false;
      if (statusFilter === "live" && !isLiveStatus(execution.status)) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "live" &&
        execution.status !== statusFilter
      ) {
        return false;
      }
      if (needle === "") return true;
      const haystack =
        `${execution.id} ${execution.workflowTitle} ${execution.position ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [executions, workflowFilter, statusFilter, query]);

  const counts = useMemo(
    () => ({
      total: executions.length,
      live: executions.filter((e) => isLiveStatus(e.status)).length,
      failed: executions.filter((e) => e.status === "failed").length,
    }),
    [executions],
  );

  async function login(token: string): Promise<string | null> {
    try {
      if (api.unlock) {
        await api.unlock(token);
      } else {
        setStoredToken(token);
      }
      await api.listWorkflows();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (!api.unlock) clearStoredToken();
        return "Invalid token — try again.";
      }
      return "Something went wrong — try again.";
    }
    setAuthRequired(true);
    setLocked(false);
    return null;
  }

  function logout() {
    clearStoredToken();
    if (DEMO) setApi(createDemoApi({ locked: true }));
    setDetail(null);
    setLocked(true);
  }

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await refreshLists();
    } catch (error) {
      if (noteUnauthorized(error)) return;
      pushToast(
        "error",
        error instanceof ApiError ? `${label}: ${error.message}` : `Failed to ${label}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function startWorkflow(workflow: string, input: unknown) {
    setBusy(true);
    try {
      const executionId = await api.startExecution(workflow, input);
      setStarting(false);
      setView("executions");
      setWorkflowFilter(null);
      setStatusFilter("all");
      setQuery("");
      setSelectedId(executionId);
      pushToast("success", `Started ${truncateMiddle(executionId)}.`);
      await refreshLists();
    } catch (error) {
      if (!noteUnauthorized(error)) {
        pushToast(
          "error",
          error instanceof ApiError ? error.message : "Failed to start.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendSignal(signal: string, payload: unknown) {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.sendSignal(selectedId, signal, payload);
      setSignalling(false);
      pushToast("success", `Delivered ${signal}.`);
    } catch (error) {
      if (!noteUnauthorized(error)) {
        pushToast(
          "error",
          error instanceof ApiError ? error.message : "Failed to signal.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function exportExecution(detailToExport: StudioExecutionDetail) {
    const payload = JSON.stringify(detailToExport, null, 2);
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${detailToExport.workflowKey}-${detailToExport.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast("success", "Execution JSON exported.");
  }

  const selectedWorkflow = workflows.find(
    (workflow) => workflow.key === detail?.workflowKey,
  );
  const detailSignals = selectedWorkflow?.signals ?? [];
  const waitingSignalId = detail?.timeline.find(
    (node) => node.state === "waiting" && node.wait?.signalId,
  )?.wait?.signalId;

  if (locked) {
    return <LoginScreen demo={DEMO} onLogin={login} />;
  }

  if (offline) {
    return (
      <div className="offline">
        <h1>Studio is offline</h1>
        <p>
          The API is unreachable. Start the server with{" "}
          <code>npm start</code> in <code>examples/durable-workflows-studio</code>,
          or preview the interface with demo data.
        </p>
        <div className="offline-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
          <a className="btn ghost" href="?demo=1">
            Open demo
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="studio">
      <Sidebar
        workflows={workflows}
        view={view}
        onView={setView}
        workflowFilter={workflowFilter}
        onWorkflowFilter={setWorkflowFilter}
        counts={counts}
        totalExecutionCount={executionFeed.totalCount ?? undefined}
        hasMoreExecutions={executionFeed.hasMore}
        stuckCount={stuck.length}
        onRecover={() =>
          act("Recover", async () => {
            setRecovering(true);
            try {
              const report = await api.recover();
              pushToast(
                "info",
                `Recovery scanned ${report.scannedCount}, resumed ${report.recoveredCount}.`,
              );
            } finally {
              setRecovering(false);
            }
          })
        }
        recovering={recovering}
        demo={DEMO}
        authed={authRequired}
        onLogout={logout}
      />

      {view === "overview" ? (
        <main className="overview-pane">
          <Overview
            executions={executions}
            schedules={schedules}
            stuck={stuck}
            workflows={workflows}
            workflowFilter={workflowFilter}
            onWorkflowFilter={setWorkflowFilter}
            onOpenExecution={(executionId) => {
              setSelectedId(executionId);
              setView("executions");
            }}
            onStart={() => setStarting(true)}
            searchRef={overviewSearchRef}
            refreshedAt={refreshedAt}
            now={now}
            totalExecutionCount={executionFeed.totalCount ?? undefined}
            hasMoreExecutions={executionFeed.hasMore}
          />
        </main>
      ) : view === "schedules" ? (
        <main className="schedules-pane">
          <Schedules
            schedules={schedules}
            workflows={workflows}
            busy={busy}
            now={now}
            onCreate={(body) =>
              act("Create schedule", async () => {
                await api.createSchedule(body);
                pushToast("success", "Schedule created.");
              })
            }
            onUpdate={(id, body) =>
              act("Update schedule", async () => {
                await api.updateSchedule(id, body);
                pushToast("success", "Schedule updated.");
              })
            }
            onPreview={previewSchedule}
            onPause={(id) => act("Pause", () => api.pauseSchedule(id))}
            onResume={(id) => act("Resume", () => api.resumeSchedule(id))}
            onRemove={(id) =>
              act("Delete", async () => {
                await api.removeSchedule(id);
                pushToast("success", "Schedule deleted.");
              })
            }
          />
        </main>
      ) : (
        <>
          <section className="list-pane" aria-label="Executions">
            <div className="list-head">
              <input
                ref={searchRef}
                className="search-input"
                placeholder="Search…  ( / )"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn primary small"
                disabled={workflows.length === 0}
                onClick={() => setStarting(true)}
                title="New execution ( n )"
              >
                + New
              </button>
            </div>
            <div className="filter-row" role="tablist" aria-label="Status filter">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === filter.id}
                  className={`chip-btn${statusFilter === filter.id ? " active" : ""}`}
                  onClick={() => setStatusFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <ExecutionList
              executions={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              now={now}
              hasMore={executionFeed.hasMore}
              loading={executionFeed.loading}
              loadingMore={executionFeed.loadingMore}
              onLoadMore={executionFeed.loadMore}
              loadedCount={executions.length}
              filtered={
                query.trim() !== "" ||
                workflowFilter !== null ||
                statusFilter !== "all"
              }
            />
          </section>
          <main className="detail-pane">
            {detail ? (
              <ExecutionDetail
                detail={detail}
                workflow={selectedWorkflow}
                now={now}
                onSignal={(signalId) => {
                  setSignalPreset(signalId);
                  setSignalling(true);
                }}
                onCancel={() => setConfirming("cancel")}
                onRetry={() => setConfirming("retry")}
                onForceFail={() => setConfirming("force-fail")}
                onSkip={() => setOperatorAction("skip")}
                onEdit={() => setOperatorAction("edit")}
                onExport={() => exportExecution(detail)}
                onOpenExecution={setSelectedId}
              />
            ) : (
              <div className="empty-detail">
                <p className="empty-title">Select an execution</p>
                <p className="empty-sub">
                  Watch steps complete, signals arrive and branches resolve —
                  live.
                </p>
                <div className="empty-meta">
                  {Object.entries(EXECUTION_STATUS_META).map(([status, meta]) => (
                    <span key={status} className={`tag tone-${meta.tone}`}>
                      {meta.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {starting && workflows.length > 0 ? (
        <StartModal
          workflows={workflows}
          initialWorkflow={workflowFilter}
          busy={busy}
          onStart={startWorkflow}
          onClose={() => setStarting(false)}
        />
      ) : null}
      {signalling && detail ? (
        detailSignals.length > 0 ? (
          <SignalModal
            signals={detailSignals}
            initialSignal={signalPreset ?? waitingSignalId}
            busy={busy}
            onSend={sendSignal}
            onClose={() => setSignalling(false)}
          />
        ) : (
          <Modal
            title="Send signal"
            subtitle="Deliver an event to the waiting execution."
            onClose={() => setSignalling(false)}
          >
            <p className="confirm-message">
              {selectedWorkflow
                ? "This workflow defines no signals."
                : "Workflow metadata is still loading — try again in a moment."}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSignalling(false)}
              >
                Close
              </button>
            </div>
          </Modal>
        )
      ) : null}
      {confirming === "cancel" && selectedId ? (
        <ConfirmDialog
          title="Cancel execution"
          message="Request cancellation? Running steps observe it cooperatively; waits resolve as cancelled."
          confirmLabel="Cancel execution"
          danger
          onConfirm={() => {
            setConfirming(null);
            void act("Cancel", () => api.cancelExecution(selectedId));
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "retry" && selectedId ? (
        <ConfirmDialog
          title="Retry execution"
          message="Roll the execution back to pending and resume it from memoized steps?"
          confirmLabel="Retry execution"
          onConfirm={() => {
            setConfirming(null);
            void act("Retry", () => api.retryExecution(selectedId));
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "force-fail" && selectedId ? (
        <ReasonDialog
          title="Force fail"
          message="Mark the execution failed immediately."
          confirmLabel="Force fail"
          placeholder="Why is this execution being failed?"
          onConfirm={(reason) => {
            setConfirming(null);
            void act("Force fail", () => api.forceFailExecution(selectedId, reason));
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {operatorAction && detail ? (
        <OperatorDialog
          action={operatorAction}
          detail={detail}
          busy={busy}
          onSubmit={(stepId, reason, result) => {
            const action = operatorAction;
            setOperatorAction(null);
            void act(action === "skip" ? "Skip step" : "Edit state", async () => {
              if (action === "skip") {
                await api.skipStep(detail.id, stepId, reason);
                pushToast("success", `Skipped ${stepId}.`);
              } else {
                await api.editState(detail.id, stepId, result, reason);
                pushToast("success", `Updated ${stepId}.`);
              }
            });
          }}
          onClose={() => setOperatorAction(null)}
        />
      ) : null}
      <Toasts toasts={toasts} />
    </div>
  );
}

function truncateMiddle(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}
