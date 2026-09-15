import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App.js";
import { ExecutionDetail } from "./components/ExecutionDetail.js";
import { ExecutionList } from "./components/ExecutionList.js";
import { Overview } from "./components/Overview.js";
import { Sidebar } from "./components/Sidebar.js";
import { SignalModal } from "./components/SignalModal.js";
import { StartModal } from "./components/StartModal.js";
import { Schedules } from "./components/Schedules.js";
import { Timeline } from "./components/Timeline.js";
import { createDemoApi } from "./demo.js";

// Effects never run under renderToString, but module bodies and event-free
// render paths still touch `window`.
(globalThis as { window: unknown }).window = {
  location: { search: "", pathname: "/" },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const noop = () => {};
const noFires = async () => [];

describe("studio rendering", () => {
  it("renders the app shell without crashing", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Durable Studio");
    expect(html).toContain("See what changed");
  });

  it("renders searchable overview insights and charts", async () => {
    const api = createDemoApi();
    const [workflows, executions, schedules, stuck] = await Promise.all([
      api.listWorkflows(),
      api.listExecutions(),
      api.listSchedules(),
      api.listStuck(),
    ]);
    const searchRef = { current: null };
    const html = renderToString(
      <Overview
        workflows={workflows}
        executions={executions}
        schedules={schedules}
        stuck={stuck}
        workflowFilter={null}
        onWorkflowFilter={noop}
        onOpenExecution={noop}
        onStart={noop}
        searchRef={searchRef}
        refreshedAt={Date.now()}
        now={Date.now()}
      />,
    );
    expect(html).toContain("Search ID, workflow, status or current step");
    expect(html).toContain("Execution activity");
    expect(html).toContain("Status mix");
    expect(html).toContain("Latest activity");
    expect(html).toContain("Workflow health");
  });

  it("renders the execution list and sidebar", async () => {
    const api = createDemoApi();
    const [workflows, executions] = await Promise.all([
      api.listWorkflows(),
      api.listExecutions(),
    ]);
    const sidebar = renderToString(
      <Sidebar
        workflows={workflows}
        view="executions"
        onView={noop}
        workflowFilter={null}
        onWorkflowFilter={noop}
        counts={{ total: 40, live: 20, failed: 1 }}
        totalExecutionCount={1_000}
        hasMoreExecutions
        stuckCount={1}
        onRecover={noop}
        recovering={false}
        demo
      />,
    );
    expect(sidebar).toContain("Order processing");
    expect(sidebar).toContain("Incident response");
    expect(sidebar).toContain("40 of 1000 executions loaded");

    const list = renderToString(
      <ExecutionList
        executions={executions}
        selectedId={null}
        onSelect={noop}
        now={Date.now()}
        hasMore
        loadedCount={40}
      />,
    );
    expect(list).toContain("User onboarding");
    expect(list).toContain("Load older runs");
  });

  it("reveals workflow search only for larger catalogs", async () => {
    const workflows = await createDemoApi().listWorkflows();
    const compact = renderToString(
      <Sidebar
        workflows={workflows.slice(0, 5)}
        view="executions"
        onView={noop}
        workflowFilter={null}
        onWorkflowFilter={noop}
        counts={{ total: 40, live: 2, failed: 1 }}
        hasMoreExecutions
        stuckCount={1}
        onRecover={noop}
        recovering={false}
        demo
      />,
    );
    expect(compact).not.toContain("Find workflow");
    expect(compact).toContain("40 executions loaded; older runs are available");

    const expanded = renderToString(
      <Sidebar
        workflows={workflows.slice(0, 6)}
        view="executions"
        onView={noop}
        workflowFilter={null}
        onWorkflowFilter={noop}
        counts={{ total: 40, live: 2, failed: 1 }}
        stuckCount={1}
        onRecover={noop}
        recovering={false}
        demo
      />,
    );
    expect(expanded).toContain("Find workflow");
    expect(expanded).toContain("Showing 6 of 6 workflows");

    const start = renderToString(
      <StartModal
        workflows={workflows.slice(0, 6)}
        initialWorkflow={null}
        busy={false}
        onStart={noop}
        onClose={noop}
      />,
    );
    expect(start).toContain("Search 6 workflows");
  });

  it("renders a live execution with timeline, waits and branches", async () => {
    const api = createDemoApi();
    const [detail, workflows] = await Promise.all([
      api.getExecution("demo_inc_live"),
      api.listWorkflows(),
    ]);
    const workflow = workflows.find((w) => w.key === detail.workflowKey)!;

    const timeline = renderToString(
      <Timeline nodes={detail.timeline} edges={detail.edges} now={Date.now()} onSignal={noop} />,
    );
    expect(timeline).toContain("Await approval");
    expect(timeline).toContain("times out in");
    expect(timeline).toContain("branch-chip taken");
    expect(timeline).toContain("acked");
    expect(timeline).toContain("btn small primary");

    const full = renderToString(
      <ExecutionDetail
        detail={detail}
        workflow={workflow}
        now={Date.now()}
        onSignal={noop}
        onCancel={noop}
        onRetry={noop}
        onForceFail={noop}
        onSkip={noop}
        onEdit={noop}
        onExport={noop}
        onOpenExecution={noop}
      />,
    );
    expect(full).toContain("Incident response");
    expect(full).toContain("Waiting for signal");
    expect(full).toContain("approvalDecision");
    expect(full).toContain("Operate");
    expect(full).toContain("Signals · 2");
  });

  it("renders a failed execution with its error", async () => {
    const api = createDemoApi();
    const [detail, workflows] = await Promise.all([
      api.getExecution("demo_inc_failed"),
      api.listWorkflows(),
    ]);
    const html = renderToString(
      <ExecutionDetail
        detail={detail}
        workflow={workflows.find((w) => w.key === detail.workflowKey)}
        now={Date.now()}
        onSignal={noop}
        onCancel={noop}
        onRetry={noop}
        onForceFail={noop}
        onSkip={noop}
        onEdit={noop}
        onExport={noop}
        onOpenExecution={noop}
      />,
    );
    expect(html).toContain("Failed");
    expect(html).toContain("Runbook exploded");
  });

  it("renders start, signal and schedule dialogs", async () => {
    const api = createDemoApi();
    const [workflows, schedules] = await Promise.all([
      api.listWorkflows(),
      api.listSchedules(),
    ]);
    const start = renderToString(
      <StartModal
        workflows={workflows}
        initialWorkflow={null}
        busy={false}
        onStart={noop}
        onClose={noop}
      />,
    );
    expect(start).toContain("Start execution");
    expect(start).toContain("Standard order");
    expect(start).toContain("Load an example");
    expect(start).toContain("runtime input schema");

    const signal = renderToString(
      <SignalModal
        signals={workflows[2]!.signals}
        busy={false}
        onSend={noop}
        onClose={noop}
      />,
    );
    expect(signal).toContain("Send signal");
    expect(signal).toContain("approvalDecision");
    expect(signal).toContain("runtime payload schema");

    const schedulesHtml = renderToString(
      <Schedules
        schedules={schedules}
        workflows={workflows}
        busy={false}
        now={Date.now()}
        onCreate={noop}
        onUpdate={noop}
        onPreview={noFires}
        onPause={noop}
        onResume={noop}
        onRemove={noop}
      />,
    );
    expect(schedulesHtml).toContain("nightly-reconciliation");
  });
});
