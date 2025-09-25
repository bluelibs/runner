import { getCurrentStore } from "../definers/defineAsyncContext";

describe("getCurrentStore coverage", () => {
  it("returns undefined when no context active", () => {
    expect(getCurrentStore()).toBeUndefined();
  });
});

