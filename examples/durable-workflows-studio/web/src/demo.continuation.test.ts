import { describe, expect, it } from "vitest";
import { createDemoApi } from "./demo.js";

(globalThis as { window: unknown }).window = {
  setTimeout,
  clearTimeout,
};

describe("demo continuation restart", () => {
  it("shows the active tip and rejects a second live lineage", async () => {
    const api = createDemoApi();
    const source = await api.getExecution("demo_ord_continued");
    expect(source.status).toBe("continued_as_new");
    expect(source.continuedChainTipStatus).toBe("running");

    await expect(api.restartExecution(source.id)).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.getExecution(source.id)).restartedAsExecutionId).toBeUndefined();

    await api.pauseExecution("demo_ord_continued_tip");
    expect((await api.getExecution(source.id)).continuedChainTipStatus).toBe("paused");
    await api.restartExecution(source.id);
    await expect(api.resumeExecution("demo_ord_continued_tip")).rejects.toMatchObject({
      status: 409,
    });
  });
});
