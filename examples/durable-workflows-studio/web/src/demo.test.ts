import { describe, expect, it } from "vitest";
import { ApiError, type StudioApi } from "./api.js";
import { createDemoApi } from "./demo.js";

// The simulator drives its timers through `window` in browsers.
(globalThis as { window: unknown }).window = {
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};

async function waitUntil(
  check: () => Promise<boolean>,
  message: string,
  timeoutMs = 20_000,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("demo studio", () => {
  it("seeds waiting, completed and failed states", async () => {
    const api = createDemoApi();
    const workflows = await api.listWorkflows();
    expect(workflows.map((workflow) => workflow.key).sort()).toEqual([
      "incidentResponse",
      "portfolioReconciliation",
      "processOrder",
      "regionalRollup",
      "userOnboarding",
    ]);
    expect((await api.listExecutions()).length).toBe(8);
    const firstPage = await api.listExecutionPage({ limit: 3 });
    const secondPage = await api.listExecutionPage({
      limit: 3,
      offset: firstPage.nextOffset ?? 0,
    });
    expect(firstPage.executions).toHaveLength(3);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.executions).toHaveLength(3);
    expect(
      secondPage.executions.some((execution) =>
        firstPage.executions.some((first) => first.id === execution.id),
      ),
    ).toBe(false);

    const live = await api.getExecution("demo_inc_live");
    expect(live.status).toBe("sleeping");
    expect(live.position).toBe("Waiting for signal `approvalDecision`");
    const approval = live.timeline.find(
      (node) => node.id === "__signal:awaitApproval",
    )!;
    expect(approval.state).toBe("waiting");
    expect(approval.wait?.timeoutAtMs ?? 0).toBeGreaterThan(Date.now());
    expect(
      live.timeline.find((node) => node.id === "ackBranch")?.branchTaken,
    ).toBe("acked");
    expect(live.audit.length).toBeGreaterThan(0);

    const done = await api.getExecution("demo_ord_completed");
    expect(done.status).toBe("completed");
    expect(done.timeline.every((node) => node.state === "completed")).toBe(true);

    const failed = await api.getExecution("demo_inc_failed");
    expect(failed.status).toBe("failed");
    expect(
      failed.timeline.find((node) => node.id === "diagnose")?.state,
    ).toBe("failed");

    const portfolio = await api.getExecution("demo_portfolio_live");
    expect(portfolio.relations.children).toHaveLength(3);
    const child = await api.getExecution(portfolio.relations.children[0]!.id);
    expect(child.relations.parent?.id).toBe(portfolio.id);
    expect(child.timeline).toHaveLength(3);
    expect(live.signals[0]?.history.map((record) => record.state)).toEqual([
      "consumed",
      "queued",
    ]);
  });

  it("progresses executions and parks on signal waits", async () => {
    const api = createDemoApi();
    const id = await api.startExecution("processOrder", {
      orderId: "ORD-DEMO",
      customerId: "C",
      amount: 9,
    });
    let detail = await api.getExecution(id);
    await waitUntil(async () => {
      detail = await api.getExecution(id);
      return detail.timeline.some(
        (node) =>
          node.id === "__signal:awaitPaymentConfirmation" &&
          node.state === "waiting",
      );
    }, "demo order to await payment");
    expect(detail.status).toBe("sleeping");

    await api.sendSignal(id, "paymentConfirmed", { transactionId: "txn_demo" });
    await waitUntil(async () => {
      detail = await api.getExecution(id);
      return detail.status === "completed";
    }, "demo order to complete");
    expect(
      (detail.result as { transactionId: string }).transactionId,
    ).toBe("txn_demo_123");
    expect(detail.timeline.every((node) => node.state === "completed")).toBe(true);
  }, 30_000);

  it("parks the auto-runner on its email wait", async () => {
    const api = createDemoApi();
    await waitUntil(async () => {
      const detail = await api.getExecution("demo_onb_live");
      return detail.timeline.some(
        (node) =>
          node.id === "__signal:awaitEmailVerification" &&
          node.state === "waiting",
      );
    }, "demo onboarding to await email");
  }, 30_000);

  it("pushes transitions to subscribers", async () => {
    const api = createDemoApi();
    const id = await api.startExecution("userOnboarding", {
      email: "sub@example.com",
      plan: "free",
    });
    const seen = new Set<string>();
    const unsubscribe = api.subscribeExecution(id, (detail) => {
      seen.add(detail.status);
    });
    try {
      await waitUntil(async () => {
        const detail = await api.getExecution(id);
        return detail.status === "sleeping";
      }, "demo execution to sleep");
      expect(seen.has("running")).toBe(true);
      expect(seen.has("sleeping")).toBe(true);
    } finally {
      unsubscribe();
    }
  }, 30_000);

  it("mirrors cancel, retry and force-fail semantics", async () => {
    const api: StudioApi = createDemoApi();
    const id = await api.startExecution("incidentResponse", {
      incidentId: "INC-X",
      severity: "SEV-3",
      summary: "demo",
    });
    await api.cancelExecution(id);
    expect((await api.getExecution(id)).status).toBe("cancelled");
    await expect(api.cancelExecution(id)).rejects.toBeInstanceOf(ApiError);

    await api.retryExecution(id);
    await waitUntil(async () => {
      const detail = await api.getExecution(id);
      return detail.timeline.some(
        (node) => node.id === "__signal:awaitAck" && node.state === "waiting",
      );
    }, "retried demo execution to await ack");
    await api.sendSignal(id, "incidentAcknowledged", { acknowledgedBy: "ops" });
    await waitUntil(async () => {
      const detail = await api.getExecution(id);
      return detail.timeline.some(
        (node) => node.id === "__signal:awaitApproval" && node.state === "waiting",
      );
    }, "retried demo execution to await approval");
    await api.sendSignal(id, "approvalDecision", { approved: true });
    await waitUntil(async () => {
      return (await api.getExecution(id)).status === "completed";
    }, "retried demo execution to complete");
    expect((await api.getExecution(id)).attempt).toBe(2);

    const live = "demo_inc_live";
    await api.editState(live, "diagnose", { confidence: 0.99 }, "reviewed");
    await api.skipStep(live, "remediate", "handled outside automation");
    expect(
      (await api.getExecution(live)).audit.filter(
        (entry) =>
          entry.kind === "note" &&
          String(entry.detail.message).startsWith("Operator"),
      ),
    ).toHaveLength(2);
    await api.forceFailExecution(live, "demo drill");
    const failed = await api.getExecution(live);
    expect(failed.status).toBe("failed");
    expect(failed.error?.message ?? "").toMatch(/demo drill/);
    await expect(api.sendSignal(live, "approvalDecision", {})).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(api.startExecution("nope", {})).rejects.toBeInstanceOf(ApiError);
    await expect(api.getExecution("nope")).rejects.toBeInstanceOf(ApiError);
  }, 30_000);

  it("locks data behind unlock() when created locked", async () => {
    const api = createDemoApi({ locked: true });
    expect(api.isLocked?.()).toBe(true);
    await expect(api.listWorkflows()).rejects.toMatchObject({ status: 401 });
    await expect(api.listExecutions()).rejects.toMatchObject({ status: 401 });
    await expect(api.getExecution("demo_inc_live")).rejects.toMatchObject({
      status: 401,
    });
    await expect(api.unlock?.("wrong")).rejects.toMatchObject({ status: 401 });
    expect(api.isLocked?.()).toBe(true);
    await api.unlock?.("admin");
    expect(api.isLocked?.()).toBe(false);
    expect((await api.listWorkflows()).length).toBe(5);
    expect((await api.listExecutions()).length).toBe(8);
  });

  it("manages schedules, stuck and recover in memory", async () => {
    const api = createDemoApi();
    expect((await api.listSchedules()).length).toBe(2);
    expect(await api.previewSchedule({ interval: 5000 })).toHaveLength(3);
    const id = await api.createSchedule({
      workflow: "processOrder",
      input: {},
      interval: 5000,
    });
    expect((await api.listSchedules()).length).toBe(3);
    await api.updateSchedule(id, { interval: 9000, input: { revised: true } });
    const updated = (await api.listSchedules()).find(
      (schedule) => schedule.id === id,
    );
    expect(updated?.pattern).toBe("9000");
    expect(updated?.input).toEqual({ revised: true });
    await api.pauseSchedule(id);
    expect(
      (await api.listSchedules()).find((schedule) => schedule.id === id)?.status,
    ).toBe("paused");
    await api.resumeSchedule(id);
    await api.removeSchedule(id);
    expect((await api.listSchedules()).length).toBe(2);

    const stuck = await api.listStuck();
    expect(stuck.some((execution) => execution.id === "demo_inc_failed")).toBe(true);
    const report = await api.recover();
    expect(report.failedCount).toBe(0);
    expect(report.scannedCount).toBeGreaterThanOrEqual(4);
  });
});
