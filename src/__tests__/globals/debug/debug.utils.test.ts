import { hasSystemTag } from "../../../globals/resources/debug/utils";
import {
  getConfig,
  levelNormal,
  levelVerbose,
} from "../../../globals/resources/debug/types";
import { debugTag } from "../../../globals/resources/debug/debug.tag";
import { globalTags } from "../../../globals/globalTags";
import { defineResource } from "../../../define";
import { run } from "../../../run";
import { debugConfig } from "../../../globals/resources/debug/debugConfig.resource";
import { safeStringify } from "../../../models/utils/safeStringify";
import { ITaggable } from "../../../defs";

describe("debug utils and types", () => {
  it("safeStringify handles circular structures without throwing", () => {
    const a: any = {};
    a.self = a;
    const result = safeStringify(a);
    expect(typeof result).toBe("string");
    expect(result).toBe('{"self":"[Circular]"}');
  });

  it("safeStringify prints functions as placeholders", () => {
    const obj = { fn: () => {}, nested: { handler() {} } } as any;
    const result = safeStringify(obj, 2);
    expect(result).toContain('"fn": "function()"');
    expect(result).toContain('"handler": "function()"');
  });

  it("safeStringify limits depth when maxDepth is provided", () => {
    const obj = {
      level1: { level2: { level3: { x: 1 } } },
      arr1: { arr2: [1, 2, 3] },
    };
    const result = safeStringify(obj, 2, { maxDepth: 2 });
    // With maxDepth=2 we allow root and its direct children; grandchildren get summarized
    expect(result).toContain('"level2": "[Object]"');
    expect(result).toContain('"arr2": "[Array]"');
  });

  it("safeStringify depth calculation covers non-object holder branch", () => {
    // When stringifying primitives at root, replacer's `this` is not an object initially
    const result = safeStringify({ k: 1, arr: [{ deep: 1 }] }, 2, {
      maxDepth: 1,
    });
    expect(result).toContain('"k": 1');
    expect(result).toContain('"arr": "[Array]"');
  });

  it("hasSystemOrLifecycleTag detects system and lifecycle tags", () => {
    const sys: ITaggable = { tags: [globalTags.system] };
    const none: ITaggable = { tags: [] };
    expect(hasSystemTag(sys)).toBe(true);
    expect(hasSystemTag(none)).toBe(false);
  });

  it("getConfig resolves normal, verbose and overrides via taggable", () => {
    const normal = getConfig("normal");
    const verbose = getConfig("verbose");
    expect(normal).toEqual(levelNormal);
    expect(verbose).toEqual(levelVerbose);

    const custom = { ...levelNormal, logTaskInput: true };
    expect(getConfig(custom)).toEqual(custom);

    const taggable = { tags: [debugTag.with("verbose")] } satisfies ITaggable;
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
