import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { StudioExecutionDetail, StudioWorkflow } from "../../src/shared/types.js";
import { ExecutionDetail } from "./components/ExecutionDetail.js";
import { ExecutionRelations } from "./components/ExecutionRelations.js";
import { createDemoApi } from "./demo.js";

(globalThis as { window: unknown }).window = { setTimeout, clearTimeout };

const noop = () => {};

function renderActions(detail: StudioExecutionDetail, workflow: StudioWorkflow): string {
  return renderToString(
    <ExecutionDetail
      detail={detail}
      workflow={workflow}
      now={Date.now()}
      onSignal={noop}
      onCancel={noop}
      onRetry={noop}
      onPause={noop}
      onResume={noop}
      onRestart={noop}
      onForceFail={noop}
      onSkip={noop}
      onEdit={noop}
      onExport={noop}
      onOpenExecution={noop}
    />,
  );
}

describe("execution lifecycle actions", () => {
  it("shows paused actions and hides rejected actions for active continuations", async () => {
    const api = createDemoApi();
    const [paused, continued, workflows] = await Promise.all([
      api.getExecution("demo_ord_paused"),
      api.getExecution("demo_ord_continued"),
      api.listWorkflows(),
    ]);
    const workflow = workflows.find((item) => item.key === paused.workflowKey);
    if (!workflow) throw new Error(`Missing workflow '${paused.workflowKey}'.`);
    const pausedHtml = renderActions(paused, workflow);
    expect(pausedHtml).toContain(">Resume<");
    expect(pausedHtml).toContain(">Restart<");
    expect(pausedHtml).not.toContain(">Pause<");

    const continuedHtml = renderActions(continued, workflow);
    expect(continuedHtml).toContain("Continued as new");
    expect(continuedHtml).not.toContain(">Restart<");
    const relationsHtml = renderToString(
      <ExecutionRelations detail={continued} now={Date.now()} onOpen={noop} />,
    );
    expect(relationsHtml).toContain("Lifecycle lineage");
    expect(relationsHtml).toContain("demo_ord_continued_tip");

    const cancellingHtml = renderActions({ ...paused, status: "cancelling" }, workflow);
    expect(cancellingHtml).not.toContain(">Pause<");
  });
});
