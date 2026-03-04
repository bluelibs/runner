import { buildTaskInput } from "./buildTaskInput";

describe("buildTaskInput", () => {
  it("returns body by default", () => {
    const req = { body: { a: 1 } };
    expect(buildTaskInput(req, undefined)).toEqual({ a: 1 });
  });
  it("merges params, query and body when mode=merged", () => {
    const req = { params: { a: 1 }, query: { b: 2 }, body: { c: 3 } };
    expect(buildTaskInput(req, "merged")).toEqual({ a: 1, b: 2, c: 3 });
  });
  it("explicit body mode returns body", () => {
    const req = { body: { x: 42 } };
    expect(buildTaskInput(req, "body")).toEqual({ x: 42 });
  });
});
