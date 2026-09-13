import { r, run } from "../../../index";
import type { RunOptions } from "../../../index";
import { RunnerMode } from "../../../types/runner";

// Mirrors the documented run options so the normal typecheck catches regressions.
export async function documentedRunModes() {
  const testHarness = r.resource("testHarness").build();
  const runtime = await run(testHarness, {
    mode: "test",
    logs: { printThreshold: null },
  });
  const legacyMode: RunnerMode = runtime.mode;
  await runtime.dispose();

  const options: RunOptions[] = [
    { mode: "dev" },
    { mode: "prod" },
    { mode: "pre-prod" },
    { mode: "test" },
    { mode: RunnerMode.DEV },
    { mode: RunnerMode.PROD },
    { mode: RunnerMode.PRE_PROD },
    { mode: RunnerMode.TEST },
    // @ts-expect-error Only the documented mode values are supported.
    { mode: "production" },
    // @ts-expect-error Arbitrary environments are not Runner modes.
    { mode: "staging" },
    // @ts-expect-error Acceptance deployments use pre-prod, not a separate alias.
    { mode: "uat" },
  ];
  const legacyMember: RunnerMode.TEST = RunnerMode.TEST;
  return { legacyMode, legacyMember, options };
}
