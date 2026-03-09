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
import { RedisCache, redisCacheProviderResource } from "../../cache";
import { run as coreRun } from "../../../run";

describe("node entry run/shared-contract", () => {
  it("re-exports run directly from core", () => {
    expect(nodeRun).toBe(coreRun);
  });

  it("extends core resources and tags with node durable helpers", () => {
    expect(nodeResources).not.toBe(coreResources);
    expect(nodeEvents).toBe(coreEvents);
    expect(nodeTags).not.toBe(coreTags);
    expect(nodeMiddleware).toBe(coreMiddleware);

    const resources = nodeResources as Record<string, unknown>;
    const tags = nodeTags as Record<string, unknown>;

    expect(resources.runtime).toBe(coreResources.runtime);
    expect(resources.cron).toBe(coreResources.cron);
    expect(resources.durable).toBeDefined();
    expect(resources.memoryWorkflow).toBeDefined();
    expect(resources.redisWorkflow).toBeDefined();
    expect(resources.redisCacheProvider).toBeDefined();
    expect(resources.redisCacheProvider).toBe(redisCacheProviderResource);
    expect(RedisCache).toBeDefined();
    expect(tags.system).toBe(coreTags.system);
    expect(tags.cron).toBe(coreTags.cron);
    expect(tags.durableWorkflow).toBeDefined();
    expect(resources.httpClientFactory).toBeUndefined();
    expect(resources.httpSmartClientFactory).toBeUndefined();
    expect(resources.httpMixedClientFactory).toBeUndefined();
  });
});
