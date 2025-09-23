import { setPlatform } from "../../platform";
import { registerShutdownHook } from "../../processHooks";

describe("process hooks on platform", () => {
  it("registerShutdownHook is a function", () => {
    expect(typeof registerShutdownHook).toBe("function");
    expect(typeof setPlatform).toBe("function");
  });
});
