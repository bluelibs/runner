import {
  mergeResourceSubtreePolicy,
  normalizeResourceSubtreePolicy,
} from "../../definers/subtreePolicy";
import { r } from "../..";

describe("mergeResourceSubtreePolicy", () => {
  it("appends resources subtree entries when override is disabled", () => {
    const middlewareA = r.middleware
      .resource("tests-subtree-merge-resource-middleware-a")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const middlewareB = r.middleware
      .resource("tests-subtree-merge-resource-middleware-b")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const validateA = jest.fn(() => []);
    const validateB = jest.fn(() => []);

    const existing = {
      resources: {
        middleware: [{ use: middlewareA }],
      },
      validate: [validateA],
    } as any;

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        resources: {
          middleware: [{ use: middlewareB }],
        },
        validate: [validateB],
      },
      { override: false },
    );

    expect(merged.resources?.middleware).toEqual([
      { use: middlewareA, when: undefined },
      { use: middlewareB, when: undefined },
    ]);
    expect(merged.validate).toEqual([validateA, validateB]);
    expect(existing.resources.middleware).toEqual([{ use: middlewareA }]);
    expect(existing.validate).toEqual([validateA]);
  });

  it("keeps existing validators when incoming policy omits validate", () => {
    const validateA = jest.fn(() => []);

    const merged = mergeResourceSubtreePolicy(
      { validate: [validateA] },
      {
        resources: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.validate).toEqual([validateA]);
  });

  it("normalizes explicit undefined validate entries into an empty array", () => {
    expect(
      normalizeResourceSubtreePolicy({
        validate: undefined,
      }),
    ).toEqual({ validate: [] });

    expect(
      mergeResourceSubtreePolicy(
        {
          validate: undefined,
        } as any,
        {},
      ),
    ).toEqual({ validate: [] });
  });

  it("clones policies without validate markers and keeps existing validators when incoming validate is undefined", () => {
    const validateA = jest.fn(() => []);
    const validateB = jest.fn(() => []);

    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
          },
        },
        {},
      ),
    ).toEqual({
      tasks: {
        middleware: [],
      },
    });

    expect(
      mergeResourceSubtreePolicy(
        { validate: [validateA] },
        {
          validate: undefined,
        },
      ),
    ).toEqual({
      tasks: undefined,
      resources: undefined,
      validate: [validateA],
    });

    expect(
      mergeResourceSubtreePolicy(
        { validate: [validateA] },
        {
          validate: [validateB],
        },
        { override: true },
      ),
    ).toEqual({
      tasks: undefined,
      resources: undefined,
      validate: [validateB],
    });
  });
});
