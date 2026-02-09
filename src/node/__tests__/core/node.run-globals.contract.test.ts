import { globals as coreGlobals } from "../../..";
import { globals as nodeGlobals, run as nodeRun } from "../../node";
import { run as coreRun } from "../../../run";

describe("node entry run/globals contract", () => {
  it("re-exports run directly from core", () => {
    expect(nodeRun).toBe(coreRun);
  });

  it("re-exports core globals without node-only factory injections", () => {
    expect(nodeGlobals).toBe(coreGlobals);

    const resources = nodeGlobals.resources as Record<string, unknown>;
    expect(resources.httpSmartClientFactory).toBeUndefined();
    expect(resources.httpMixedClientFactory).toBeUndefined();
  });
});
