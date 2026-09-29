import {
  bindMiddlewareApplication,
  getMiddlewareApplicationIdentity,
} from "../../../models/middleware/applicationIdentity";

it("isolates execution identities and preserves direct invocation fallback", () => {
  const first = {};
  const second = {};
  expect(bindMiddlewareApplication(first, "first")).toBe(first);
  bindMiddlewareApplication(second, "second");
  expect(getMiddlewareApplicationIdentity(first, "task")).toBe("first");
  expect(getMiddlewareApplicationIdentity(second, "task")).toBe("second");
  expect(getMiddlewareApplicationIdentity({}, "task")).toBe("task");
});
