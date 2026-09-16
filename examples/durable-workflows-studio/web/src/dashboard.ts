import { isLiveStatus } from "../../src/shared/statuses.js";
import type {
  StudioExecutionStatus,
  StudioExecutionSummary,
  StudioSchedule,
  StudioWorkflow,
} from "../../src/shared/types.js";

export type DashboardStatusFilter = "all" | "live" | StudioExecutionStatus;
export type DashboardTone = "success" | "info" | "warning" | "danger";

export interface DashboardFilters {
  query: string;
  status: DashboardStatusFilter;
  workflowKey: string | null;
}

export interface ActivityBucket {
  label: string;
  total: number;
  completed: number;
  failed: number;
  live: number;
}

export interface DashboardInsight {
  tone: DashboardTone;
  label: string;
  title: string;
  detail: string;
}

export interface DashboardModel {
  metrics: {
    total: number;
    live: number;
    completed: number;
    failed: number;
    cancelled: number;
    stuck: number;
    successRate: number;
    activeSchedules: number;
    pausedSchedules: number;
  };
  statusMix: Array<{
    id: "completed" | "live" | "failed" | "cancelled";
    label: string;
    count: number;
  }>;
  activity: ActivityBucket[];
  workflowHealth: Array<{
    key: string;
    title: string;
    total: number;
    live: number;
    failed: number;
    successRate: number;
  }>;
  insights: DashboardInsight[];
}

const ACTIVITY_BUCKETS = 12;
const ACTIVITY_BUCKET_MS = 30 * 60_000;

function percent(part: number, total: number, emptyValue = 0): number {
  if (total === 0) return emptyValue;
  return Math.round((part / total) * 100);
}

function isFailed(status: StudioExecutionStatus): boolean {
  return status === "failed" || status === "compensation_failed";
}

function buildActivity(
  executions: StudioExecutionSummary[],
  nowMs: number,
): ActivityBucket[] {
  const currentBucketStart = Math.floor(nowMs / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;
  const firstBucketStart =
    currentBucketStart - (ACTIVITY_BUCKETS - 1) * ACTIVITY_BUCKET_MS;
  const buckets = Array.from({ length: ACTIVITY_BUCKETS }, (_, index) => {
    const startsAt = firstBucketStart + index * ACTIVITY_BUCKET_MS;
    return {
      label: new Date(startsAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      total: 0,
      completed: 0,
      failed: 0,
      live: 0,
    };
  });

  for (const execution of executions) {
    const createdAt = new Date(execution.createdAt).getTime();
    const index = Math.floor((createdAt - firstBucketStart) / ACTIVITY_BUCKET_MS);
    const bucket = buckets[index];
    if (!bucket || createdAt > nowMs) continue;
    bucket.total += 1;
    if (execution.status === "completed") bucket.completed += 1;
    else if (isFailed(execution.status)) bucket.failed += 1;
    else if (isLiveStatus(execution.status)) bucket.live += 1;
  }
  return buckets;
}

function buildInsights(metrics: DashboardModel["metrics"]): DashboardInsight[] {
  const reliability: DashboardInsight =
    metrics.failed > 0
      ? {
          tone: "danger",
          label: "Reliability",
          title: `${metrics.failed} failed execution${metrics.failed === 1 ? "" : "s"}`,
          detail: `${metrics.successRate}% of finished runs completed successfully.`,
        }
      : {
          tone: "success",
          label: "Reliability",
          title: "No failures in view",
          detail: "Finished executions are completing cleanly.",
        };
  const flow: DashboardInsight =
    metrics.stuck > 0
      ? {
          tone: "warning",
          label: "Flow",
          title: `${metrics.stuck} execution${metrics.stuck === 1 ? " is" : "s are"} stuck`,
          detail: "Recovery or an operator decision may be required.",
        }
      : {
          tone: metrics.live > 0 ? "info" : "success",
          label: "Flow",
          title: metrics.live > 0 ? `${metrics.live} moving now` : "Runtime is quiet",
          detail: metrics.live > 0 ? "Live work is refreshing every few seconds." : "No execution currently needs runtime capacity.",
        };
  const automation: DashboardInsight =
    metrics.pausedSchedules > 0
      ? {
          tone: "warning",
          label: "Automation",
          title: `${metrics.pausedSchedules} paused schedule${metrics.pausedSchedules === 1 ? "" : "s"}`,
          detail: `${metrics.activeSchedules} schedule${metrics.activeSchedules === 1 ? " is" : "s are"} active.`,
        }
      : {
          tone: "success",
          label: "Automation",
          title: `${metrics.activeSchedules} active schedule${metrics.activeSchedules === 1 ? "" : "s"}`,
          detail: "No scheduled automation is paused.",
        };
  return [reliability, flow, automation];
}

export function filterDashboardExecutions(
  executions: StudioExecutionSummary[],
  filters: DashboardFilters,
): StudioExecutionSummary[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return executions
    .filter((execution) => {
      if (filters.workflowKey && execution.workflowKey !== filters.workflowKey) {
        return false;
      }
      if (filters.status === "live" && !isLiveStatus(execution.status)) return false;
      if (
        filters.status !== "all" &&
        filters.status !== "live" &&
        execution.status !== filters.status
      ) {
        return false;
      }
      if (query === "") return true;
      const searchable = [
        execution.id,
        execution.workflowKey,
        execution.workflowTitle,
        execution.status,
        execution.position ?? "",
        `attempt ${execution.attempt}`,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(query);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function buildDashboardModel({
  executions,
  schedules,
  stuck,
  workflows,
  nowMs,
}: {
  executions: StudioExecutionSummary[];
  schedules: StudioSchedule[];
  stuck: StudioExecutionSummary[];
  workflows: StudioWorkflow[];
  nowMs: number;
}): DashboardModel {
  const live = executions.filter((execution) => isLiveStatus(execution.status)).length;
  const completed = executions.filter((execution) => execution.status === "completed").length;
  const failed = executions.filter((execution) => isFailed(execution.status)).length;
  const cancelled = executions.filter((execution) => execution.status === "cancelled").length;
  const finished = completed + failed + cancelled;
  const metrics = {
    total: executions.length,
    live,
    completed,
    failed,
    cancelled,
    stuck: stuck.length,
    successRate: percent(completed, finished, 100),
    activeSchedules: schedules.filter((schedule) => schedule.status === "active").length,
    pausedSchedules: schedules.filter((schedule) => schedule.status === "paused").length,
  };

  const workflowHealth = workflows
    .map((workflow) => {
      const matching = executions.filter(
        (execution) => execution.workflowKey === workflow.key,
      );
      const workflowCompleted = matching.filter(
        (execution) => execution.status === "completed",
      ).length;
      const workflowFailed = matching.filter((execution) =>
        isFailed(execution.status),
      ).length;
      const workflowCancelled = matching.filter(
        (execution) => execution.status === "cancelled",
      ).length;
      return {
        key: workflow.key,
        title: workflow.title,
        total: matching.length,
        live: matching.filter((execution) => isLiveStatus(execution.status)).length,
        failed: workflowFailed,
        successRate: percent(
          workflowCompleted,
          workflowCompleted + workflowFailed + workflowCancelled,
          100,
        ),
      };
    })
    .sort((left, right) => right.total - left.total || left.title.localeCompare(right.title));

  return {
    metrics,
    statusMix: [
      { id: "completed", label: "Completed", count: completed },
      { id: "live", label: "Live", count: live },
      { id: "failed", label: "Failed", count: failed },
      { id: "cancelled", label: "Cancelled", count: cancelled },
    ],
    activity: buildActivity(executions, nowMs),
    workflowHealth,
    insights: buildInsights(metrics),
  };
}
