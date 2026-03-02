import { mergeResourceSubtreePolicy } from "../../definers/subtreePolicy";
import { r } from "../..";

describe("mergeResourceSubtreePolicy", () => {
  it("appends resources subtree entries when override is disabled", () => {
    const middlewareA = r.middleware
      .resource("tests.subtree.merge.resource.middleware.a")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const middlewareB = r.middleware
      .resource("tests.subtree.merge.resource.middleware.b")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const validateA = jest.fn(() => []);
    const validateB = jest.fn(() => []);

    const existing = {
      resources: {
        middleware: [{ use: middlewareA }],
        validate: [validateA],
      },
    } as any;

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        resources: {
          middleware: [{ use: middlewareB }],
          validate: [validateB],
        },
      },
      { override: false },
    );

    expect(merged.resources?.middleware).toEqual([
      { use: middlewareA, when: undefined },
      { use: middlewareB, when: undefined },
    ]);
    expect(merged.resources?.validate).toEqual([validateA, validateB]);
    expect(existing.resources.middleware).toEqual([{ use: middlewareA }]);
    expect(existing.resources.validate).toEqual([validateA]);
  });
});
