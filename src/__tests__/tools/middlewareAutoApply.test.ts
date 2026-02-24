import { isMiddlewareAutoAppliedToTarget } from "../../tools/middlewareAutoApply";

describe("middleware auto-apply matcher", () => {
  const visible = jest.fn(() => true);
  const subtree = jest.fn(() => true);

  beforeEach(() => {
    visible.mockClear();
    subtree.mockClear();
    visible.mockReturnValue(true);
    subtree.mockReturnValue(true);
  });

  it("matches where-visible middleware", () => {
    const result = isMiddlewareAutoAppliedToTarget(
      {
        id: "tests.autoApply.visible",
        applyTo: { scope: "where-visible" },
      },
      { id: "tests.target.visible" },
      {
        isVisibleToTarget: visible,
        isInSubtreeScope: subtree,
      },
    );

    expect(result).toBe(true);
    expect(visible).toHaveBeenCalledWith(
      "tests.autoApply.visible",
      "tests.target.visible",
    );
    expect(subtree).not.toHaveBeenCalled();
  });

  it("matches subtree middleware and applies predicate", () => {
    const result = isMiddlewareAutoAppliedToTarget(
      {
        id: "tests.autoApply.subtree",
        applyTo: {
          scope: "subtree",
          when: (target) => target.id.endsWith(".ok"),
        },
      },
      { id: "tests.target.ok" },
      {
        isVisibleToTarget: visible,
        isInSubtreeScope: subtree,
      },
    );

    expect(result).toBe(true);
    expect(subtree).toHaveBeenCalledWith(
      "tests.autoApply.subtree",
      "tests.target.ok",
    );
    expect(visible).not.toHaveBeenCalled();
  });

  it("returns false for invalid scope values", () => {
    const result = isMiddlewareAutoAppliedToTarget(
      {
        id: "tests.autoApply.invalid",
        applyTo: { scope: "invalid" as "where-visible" },
      },
      { id: "tests.target.invalid" },
      {
        isVisibleToTarget: visible,
        isInSubtreeScope: subtree,
      },
    );

    expect(result).toBe(false);
  });

  it("returns false when middleware is not auto-applied", () => {
    const result = isMiddlewareAutoAppliedToTarget(
      {
        id: "tests.autoApply.none",
      },
      { id: "tests.target.none" },
      {
        isVisibleToTarget: visible,
        isInSubtreeScope: subtree,
      },
    );

    expect(result).toBe(false);
  });
});
