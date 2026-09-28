import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createLifecycleManager } from "../../helpers/lifecycle.test.helpers";

describe("durable: maxContinuationDepth config", () => {
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects %p at construction instead of silently disabling the bound",
    (maxContinuationDepth) => {
      expect(() =>
        createLifecycleManager({
          store: new MemoryStore(),
          execution: { maxContinuationDepth },
        }),
      ).toThrow("execution.maxContinuationDepth");
    },
  );

  it.each([undefined, 0, 1, 1000])("accepts %p", (maxContinuationDepth) => {
    expect(() =>
      createLifecycleManager({
        store: new MemoryStore(),
        execution: { maxContinuationDepth },
      }),
    ).not.toThrow();
  });
});
