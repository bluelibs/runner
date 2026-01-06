import { assertTaskRouted } from "..";
import { phantomTaskNotRoutedError } from "../errors";

describe("assertTaskRouted", () => {
  it("returns the value when it is defined", () => {
    expect(assertTaskRouted("ok", "spec.task")).toBe("ok");
  });

  it("throws phantomTaskNotRoutedError when value is undefined", () => {
    try {
      assertTaskRouted(undefined, "spec.phantom.missingRoute");
      throw new Error("Expected assertTaskRouted() to throw");
    } catch (e) {
      expect(phantomTaskNotRoutedError.is(e)).toBe(true);
      expect(String((e as any)?.message)).toContain(
        'Phantom task "spec.phantom.missingRoute" is not routed',
      );
    }
  });
});

