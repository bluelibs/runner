import { r, run } from "../../index";
import { RunnerMode } from "../../types/runner";

describe("documented runtime mode literals", () => {
  it.each([
    ["test", RunnerMode.TEST],
    ["dev", RunnerMode.DEV],
    ["prod", RunnerMode.PROD],
    ["pre-prod", RunnerMode.PRE_PROD],
  ] as const)(
    "accepts %s and propagates it to factories",
    async (mode, expected) => {
      const seenModes: RunnerMode[] = [];
      const testHarness = r
        .resource("testHarness")
        .register((_config, resolvedMode) => {
          seenModes.push(resolvedMode);
          return [];
        })
        .build();

      const runtime = await run(testHarness, {
        mode,
        logs: { printThreshold: null },
      });
      try {
        expect(runtime.mode).toBe(expected);
        expect(runtime.runOptions.mode).toBe(expected);
        expect(seenModes).toEqual([expected]);
      } finally {
        await runtime.dispose();
      }
    },
  );
});
