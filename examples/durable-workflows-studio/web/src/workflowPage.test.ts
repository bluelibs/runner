import { describe, expect, it } from "vitest";
import { workflowPage } from "../../src/shared/workflowPage.js";
import { DEMO_WORKFLOWS } from "./demoWorkflows.js";

describe("server catalog pagination", () => {
  const catalog = Array.from({ length: 100000 }, (_, index) => ({
    ...DEMO_WORKFLOWS[0],
    key: `type-${index}`,
    title: `Workflow ${index}`,
  }));
  it("returns bounded pages and finds a workflow beyond the first 99,999 entries", () => {
    const first = workflowPage(catalog);
    expect(first.workflows).toHaveLength(20);
    expect(first.nextCursor).toBe("20");
    expect(first.total).toBe(100000);
    expect(
      workflowPage(catalog, { cursor: first.nextCursor! }).workflows[0].key,
    ).toBe("type-20");
    const found = workflowPage(catalog, { query: "type-99999" });
    expect(found.workflows.map((workflow) => workflow.key)).toEqual([
      "type-99999",
    ]);
    expect(found.nextCursor).toBeNull();
    expect(workflowPage(catalog, { cursor: "99990" }).workflows).toHaveLength(
      10,
    );
    expect(workflowPage(catalog, { query: "absent" }).workflows).toEqual([]);
  });
  it("continues after matched pages without skipping the lookahead row", () => {
    const first = workflowPage(catalog, { query: "type-99", limit: 2 });
    expect(first.workflows.map((workflow) => workflow.key)).toEqual([
      "type-99",
      "type-990",
    ]);
    expect(
      workflowPage(catalog, {
        query: "type-99",
        limit: 2,
        cursor: first.nextCursor!,
      }).workflows.map((workflow) => workflow.key),
    ).toEqual(["type-991", "type-992"]);
  });
  it("rejects malformed pagination", () => {
    for (const cursor of ["NaN", "-1", "1.5"])
      expect(() => workflowPage(catalog, { cursor })).toThrow();
    for (const limit of [0, 101, 1.5])
      expect(() => workflowPage(catalog, { limit })).toThrow();
  });
});
