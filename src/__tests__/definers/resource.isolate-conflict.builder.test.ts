import { r } from "../..";
import { isolateConflictError } from "../../errors";

describe("resource builder: isolate deny+only conflict", () => {
  it("throws at build time when deny and only are in the same isolate() call", () => {
    expect(() => {
      r.resource("tests.isolate.conflict.same-call.resource").isolate({
        deny: ["a.task"],
        only: ["b.task"],
      });
    }).toThrow(expect.objectContaining({ id: isolateConflictError.id }));
  });

  it("throws at build time when deny is set first and only is added via chaining", () => {
    expect(() => {
      r.resource("tests.isolate.conflict.chained-deny-first.resource")
        .isolate({ deny: ["a.task"] })
        .isolate({ only: ["b.task"] });
    }).toThrow(expect.objectContaining({ id: isolateConflictError.id }));
  });

  it("throws at build time when only is set first and deny is added via chaining", () => {
    expect(() => {
      r.resource("tests.isolate.conflict.chained-only-first.resource")
        .isolate({ only: ["a.task"] })
        .isolate({ deny: ["b.task"] });
    }).toThrow(expect.objectContaining({ id: isolateConflictError.id }));
  });

  it("error message includes the resource id", () => {
    const resourceId = "tests.isolate.conflict.error-message.resource";
    let caught: unknown;
    try {
      r.resource(resourceId).isolate({ deny: ["a.task"], only: ["b.task"] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({
      id: isolateConflictError.id,
      message: expect.stringContaining(resourceId),
    });
  });

  it("allows deny-only (no only) without throwing", () => {
    expect(() => {
      r.resource("tests.isolate.conflict.deny-only.resource")
        .isolate({ deny: ["a.task"] })
        .build();
    }).not.toThrow();
  });

  it("allows only-only (no deny) without throwing", () => {
    expect(() => {
      r.resource("tests.isolate.conflict.only-only.resource")
        .isolate({ only: ["a.task"] })
        .build();
    }).not.toThrow();
  });
});
