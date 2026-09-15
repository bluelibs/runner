import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

interface TransformingInput {
  value: number;
  normalizationPasses?: number;
}

describe("durable: preflight input validation", () => {
  it("lets the Runner task pipeline transform persisted source input once", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("durable-input-preflight");
    let parseCalls = 0;
    const workflow = r
      .task<TransformingInput>("transforming-input")
      .inputSchema({
        parse(value: unknown): TransformingInput {
          parseCalls += 1;
          if (
            typeof value !== "object" ||
            value === null ||
            !("value" in value) ||
            typeof value.value !== "number"
          ) {
            throw new Error("value must be a number");
          }
          const previousPasses =
            "normalizationPasses" in value &&
            typeof value.normalizationPasses === "number"
              ? value.normalizationPasses
              : 0;
          return {
            value: value.value,
            normalizationPasses: previousPasses + 1,
          };
        },
      })
      .run(async (input) => input)
      .build();
    const app = r
      .resource("app")
      .register([resources.durable, durable.with({ store }), workflow])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    try {
      const result = await service.startAndWait(
        workflow,
        { value: 7 },
        {
          waitTimeout: 5_000,
          waitPollIntervalMs: 5,
        },
      );
      const execution = await store.getExecution(result.durable.executionId);

      expect(result.data).toEqual({ value: 7, normalizationPasses: 1 });
      expect(execution?.input).toEqual({ value: 7 });
      expect(parseCalls).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });
});
