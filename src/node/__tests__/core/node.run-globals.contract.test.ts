import {
  resources as coreResources,
  events as coreEvents,
  tags as coreTags,
  middleware as coreMiddleware,
} from "../../..";
import {
  resources as nodeResources,
  events as nodeEvents,
  tags as nodeTags,
  middleware as nodeMiddleware,
  run as nodeRun,
} from "../../node";
import { run as coreRun } from "../../../run";

describe("node entry run/shared-contract", () => {
  it("re-exports run directly from core", () => {
    expect(nodeRun).toBe(coreRun);
  });

  it("re-exports the same core resource/tag/event/middleware registries", () => {
    expect(nodeResources).toBe(coreResources);
    expect(nodeEvents).toBe(coreEvents);
    expect(nodeTags).toBe(coreTags);
    expect(nodeMiddleware).toBe(coreMiddleware);

    const resources = nodeResources as Record<string, unknown>;
    expect(resources.httpClientFactory).toBeUndefined();
    expect(resources.httpSmartClientFactory).toBeUndefined();
    expect(resources.httpMixedClientFactory).toBeUndefined();
  });
});
