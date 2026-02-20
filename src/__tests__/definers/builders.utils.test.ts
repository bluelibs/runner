import { r } from "../..";
import {
  mergeArray,
  mergeDepsNoConfig,
  cloneState,
} from "../../definers/builders/utils";
import { mergeArray as mergeErrorBuilderArray } from "../../definers/builders/error/utils";
import { mergeArray as mergeTagBuilderArray } from "../../definers/builders/tag/utils";
import "../../definers/builders/task.phantom";
import { makeErrorBuilder } from "../../definers/builders/error/fluent-builder";
import { defineError } from "../../definers/defineError";

describe("definers builders utils", () => {
  it("cloneState freezes and merges patch", () => {
    const state = { a: 1, b: 2 };
    const next = cloneState<typeof state, { a: number; b: number; c: number }>(
      state,
      { c: 3 },
    );
    expect(Object.isFrozen(next)).toBe(true);
    expect(next).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("mergeArray appends or overrides", () => {
    expect(mergeArray([1, 2], [3], false)).toEqual([1, 2, 3]);
    expect(mergeArray([1, 2], [3], true)).toEqual([3]);
    expect(mergeArray(undefined, [3], false)).toEqual([3]);
  });

  it("error/tag builder utils re-export mergeArray", () => {
    expect(mergeErrorBuilderArray([1], [2], false)).toEqual([1, 2]);
    expect(mergeTagBuilderArray([1], [2], true)).toEqual([2]);
  });

  it("mergeDepsNoConfig merges objects and/or functions", () => {
    const a = r
      .task("tests.dep.a")
      .run(async () => "a")
      .build();
    const b = r
      .task("tests.dep.b")
      .run(async () => "b")
      .build();

    const eObj = { a };
    const aObj = { b };
    expect(mergeDepsNoConfig(eObj, aObj, false)).toEqual({ a, b });

    const eFn = () => ({ a });
    const aFn = () => ({ b });
    const mergedFn = mergeDepsNoConfig(eFn, aFn, false);
    expect(typeof mergedFn).toBe("function");
    expect((mergedFn as () => unknown)()).toEqual({ a, b });

    const mergedFn2 = mergeDepsNoConfig(eFn, aObj, false);
    expect((mergedFn2 as () => unknown)()).toEqual({ a, b });

    const mergedFn3 = mergeDepsNoConfig(eObj, aFn, false);
    expect((mergedFn3 as () => unknown)()).toEqual({ a, b });

    const overridden = mergeDepsNoConfig(eObj, aObj, true);
    expect(overridden).toEqual({ b });
  });
});

describe("error fluent builder + defineError", () => {
  it("makeErrorBuilder builds via defineError", () => {
    const helper = makeErrorBuilder({
      id: "tests.errors.fluent",
      filePath: "tests/builders.utils.test.ts",
      serialize: (d: { message: string }) => JSON.stringify(d),
      parse: (s: string) => JSON.parse(s),
      dataSchema: { parse: (v: unknown) => v as { message: string } },
      format: (d) => d.message,
      meta: { title: "t" },
    })
      .meta({ title: "t2" })
      .build();

    expect(helper.id).toBe("tests.errors.fluent");
    expect(() => helper.throw({ message: "Boom" })).toThrow();
  });

  it("defineError defaults format when missing", () => {
    expect.assertions(1);
    const E = defineError<{ message: string }>({
      id: "tests.errors.defaultFormat",
      dataSchema: { parse: (v: unknown) => v as { message: string } },
    });

    try {
      E.throw({ message: "x" });
    } catch (err) {
      expect(E.is(err)).toBe(true);
    }
  });

  it("defineError meta getter falls back for nullish meta", () => {
    const E = defineError({
      id: "tests.errors.nullMeta",
      format: () => "x",
      meta: null as unknown as Record<string, never>,
    });

    expect(E.meta).toEqual({});
  });
});
