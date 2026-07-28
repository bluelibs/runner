import { Match, type MatchPattern, check, errors } from "../..";
import { CHECK_MAX_DEPTH_EXCEEDED_ERROR_ID } from "../../tools/check";

type Tree = { value: number; children: Tree[] };

const getTreePattern = (): MatchPattern =>
  Match.ObjectIncluding({
    value: Number,
    children: Match.ArrayOf(Match.Lazy(getTreePattern)),
  });

const treePattern = getTreePattern();

function buildTree(depth: number): Tree {
  let current: Tree = { value: 0, children: [] };
  for (let level = 1; level <= depth; level += 1) {
    current = { value: level, children: [current] };
  }
  return current;
}

function caughtError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw.");
}

describe("check() / Match depth budget", () => {
  it("aborts pathologically nested values with a typed error instead of overflowing the stack", () => {
    const error = caughtError(() => check(buildTree(20000), treePattern));

    expect(errors.checkMaxDepthExceededError.is(error)).toBe(true);
    expect((error as { id: string }).id).toBe(CHECK_MAX_DEPTH_EXCEEDED_ERROR_ID);
    expect((error as { data: { maxDepth: number } }).data.maxDepth).toBe(1000);
    expect((error as Error).message).toContain(
      "Maximum pattern-matching depth of 1000 exceeded",
    );
  });

  it("keeps shallow valid and invalid payloads behaving as before", () => {
    const shallow = buildTree(3);
    expect(check(shallow, treePattern)).toBe(shallow);

    const bad = { value: "nope", children: [] };
    const error = caughtError(() => check(bad, treePattern));
    expect(errors.matchError.is(error)).toBe(true);
  });

  it("honors a custom maxDepth on check()", () => {
    const error = caughtError(() =>
      check(buildTree(10), treePattern, { maxDepth: 8 }),
    );
    expect(errors.checkMaxDepthExceededError.is(error)).toBe(true);
  });

  it("accepts Infinity to disable the limit explicitly", () => {
    // Above the specifiable-budget range a guard would fire, but safely below
    // the engine's real recursion ceiling (well under 20000 levels; the
    // matcher spends ~6 frames per nesting level).
    const deep = buildTree(200);
    expect(() =>
      check(deep, treePattern, { maxDepth: Infinity }),
    ).not.toThrow();
  });

  it.each([[-1], [NaN], ["10"], [null]])(
    "rejects invalid maxDepth option %p",
    (maxDepth) => {
      const error = caughtError(() =>
        check(buildTree(1), treePattern, {
          maxDepth: maxDepth as unknown as number,
        }),
      );
      expect(errors.checkInvalidOptionsError.is(error)).toBe(true);
    },
  );

  it("carries maxDepth on compiled schemas through parse() and test()", () => {
    const strictSchema = Match.compile(treePattern, { maxDepth: 8 });
    expect(
      errors.checkMaxDepthExceededError.is(
        caughtError(() => strictSchema.parse(buildTree(10))),
      ),
    ).toBe(true);
    expect(
      errors.checkMaxDepthExceededError.is(
        caughtError(() => strictSchema.test(buildTree(10))),
      ),
    ).toBe(true);

    const defaultSchema = Match.compile(treePattern);
    expect(
      errors.checkMaxDepthExceededError.is(
        caughtError(() => defaultSchema.parse(buildTree(20000))),
      ),
    ).toBe(true);

    const unlimitedSchema = Match.compile(treePattern, { maxDepth: Infinity });
    expect(unlimitedSchema.parse(buildTree(200))).toBeDefined();
    expect(unlimitedSchema.test(buildTree(200))).toBe(true);
  });

  it("applies the budget across Match.OneOf candidate contexts", () => {
    const getOneOfTree = (): MatchPattern =>
      Match.OneOf(
        Match.ObjectIncluding({
          value: Number,
          children: Match.ArrayOf(Match.Lazy(getOneOfTree)),
        }),
      );

    const error = caughtError(() => check(buildTree(20000), getOneOfTree()));
    // Without candidate-context budget propagation this would blow the stack
    // (RangeError) instead of raising the typed depth error.
    expect(errors.checkMaxDepthExceededError.is(error)).toBe(true);
  });

  it("applies the budget inside plain-object schemas too", () => {
    const compiled = Match.compile({
      id: Match.UUID,
      tree: treePattern,
    });

    const error = caughtError(() =>
      compiled.parse({
        id: crypto.randomUUID(),
        tree: buildTree(20000),
      }),
    );
    expect(errors.checkMaxDepthExceededError.is(error)).toBe(true);
  });
});
