import { describe, expect, it } from "vitest";
import type {
  StudioExecutionSummary,
  StudioSchedule,
  StudioWorkflow,
} from "../../src/shared/types.js";
import {
  buildDashboardModel,
  filterDashboardExecutions,
} from "./dashboard.js";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

function execution(
  id: string,
  status: StudioExecutionSummary["status"],
  minutesAgo: number,
  workflowKey = "orders",
): StudioExecutionSummary {
  const timestamp = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    id,
    workflowKey,
    workflowTitle: workflowKey === "orders" ? "Order processing" : "Onboarding",
    status,
    attempt: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    position: status === "sleeping" ? "Waiting for payment signal" : null,
  };
}

const workflows: StudioWorkflow[] = [
  {
    key: "orders",
    title: "Order processing",
    category: "commerce",
    description: "Orders",
    signals: [],
    presets: [],
    graph: { nodes: [], edges: [] },
  },
  {
    key: "onboarding",
    title: "Onboarding",
    category: "growth",
    description: "Users",
    signals: [],
    presets: [],
    graph: { nodes: [], edges: [] },
  },
];

const schedules: StudioSchedule[] = [
  {
    id: "active",
    workflowKey: "orders",
    workflowTitle: "Order processing",
    type: "cron",
    pattern: "0 * * * *",
    input: {},
    status: "active",
    lastRun: null,
    nextRun: new Date(NOW + 60_000).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  },
  {
    id: "paused",
    workflowKey: "onboarding",
    workflowTitle: "Onboarding",
    type: "interval",
    pattern: "60000",
    input: {},
    status: "paused",
    lastRun: null,
    nextRun: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  },
];

const executions = [
  execution("ord-complete", "completed", 20),
  execution("ord-failed", "failed", 15),
  execution("ord-waiting", "sleeping", 10),
  execution("user-running", "running", 5, "onboarding"),
];

describe("dashboard model", () => {
  it("summarises runtime health and recent activity", () => {
    const model = buildDashboardModel({
      executions,
      schedules,
      stuck: [executions[1]!],
      workflows,
      nowMs: NOW,
    });

    expect(model.metrics).toMatchObject({
      total: 4,
      live: 2,
      completed: 1,
      failed: 1,
      stuck: 1,
      successRate: 50,
      activeSchedules: 1,
      pausedSchedules: 1,
    });
    expect(model.activity.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(4);
    expect(model.statusMix.map((segment) => [segment.id, segment.count])).toEqual([
      ["completed", 1],
      ["live", 2],
      ["failed", 1],
      ["cancelled", 0],
    ]);
    expect(model.workflowHealth[0]).toMatchObject({
      key: "orders",
      total: 3,
      live: 1,
      failed: 1,
      successRate: 50,
    });
    expect(model.insights.map((insight) => insight.tone)).toEqual([
      "danger",
      "warning",
      "warning",
    ]);
  });

  it("searches useful fields and combines status and workflow filters", () => {
    expect(
      filterDashboardExecutions(executions, {
        query: "payment signal",
        status: "live",
        workflowKey: "orders",
      }).map((item) => item.id),
    ).toEqual(["ord-waiting"]);

    expect(
      filterDashboardExecutions(executions, {
        query: "USER-RUNNING",
        status: "all",
        workflowKey: null,
      }).map((item) => item.id),
    ).toEqual(["user-running"]);
  });

  it("keeps empty runtime metrics finite and actionable", () => {
    const model = buildDashboardModel({
      executions: [],
      schedules: [],
      stuck: [],
      workflows,
      nowMs: NOW,
    });

    expect(model.metrics.successRate).toBe(100);
    expect(model.workflowHealth.every((item) => item.successRate === 100)).toBe(true);
    expect(model.insights[0]).toMatchObject({ tone: "success" });
  });
});
