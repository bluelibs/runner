import {
  hasSystemOrLifecycleTag,
  safeStringify,
} from "../../globals/resources/debug/utils";
import {
  getConfig,
  levelNormal,
  levelVerbose,
} from "../../globals/resources/debug/types";
import { debugTag } from "../../globals/resources/debug/debug.tag";
import { globalTags } from "../../globals/globalTags";
import { defineResource } from "../../define";
import { createTestResource } from "../../testing";
import { run } from "../../run";
import { debugConfig } from "../../globals/resources/debug/debugConfig.resource";

describe("debug utils and types", () => {
  it("safeStringify handles circular structures without throwing", () => {
    const a: any = {};
    a.self = a;
    const result = safeStringify(a);
    expect(typeof result).toBe("string");
    expect(result).toBe("[object Object]");
  });

  it("hasSystemOrLifecycleTag detects system and lifecycle tags", () => {
    const sys = { meta: { tags: [globalTags.system] } } as any;
    const life = { meta: { tags: [globalTags.lifecycle] } } as any;
    const none = { meta: { tags: [] } } as any;
    expect(hasSystemOrLifecycleTag(sys)).toBe(true);
    expect(hasSystemOrLifecycleTag(life)).toBe(true);
    expect(hasSystemOrLifecycleTag(none)).toBe(false);
  });

  it("getConfig resolves normal, verbose and overrides via taggable", () => {
    const normal = getConfig("normal");
    const verbose = getConfig("verbose");
    expect(normal).toEqual(levelNormal);
    expect(verbose).toEqual(levelVerbose);

    const custom = { ...levelNormal, logTaskInput: true };
    expect(getConfig(custom)).toEqual(custom);

    const taggable = { meta: { tags: [debugTag.with("verbose")] } } as any;
    const overridden = getConfig("normal", taggable);
    expect(overridden).toEqual(levelVerbose);
  });

  it("debugConfig resource returns the resolved config", async () => {
    const app = defineResource({
      id: "tests.debug.config.app",
      register: [debugConfig.with("verbose")],
      dependencies: { cfg: debugConfig },
      async init(_cfg, { cfg }) {
        return cfg;
      },
    });
    const { value } = await run(app);
    expect(value.logTaskInput).toBe(true);
    expect(value.logEventEmissionOnRun).toBe(true);
  });
});
