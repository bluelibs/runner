import { detectColorSupport } from "../../models/Logger";

describe("Logger detectColorSupport branches", () => {
  const original = process.env.NO_COLOR;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  });

  it("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    expect(detectColorSupport()).toBe(false);
  });

  it("checks tty when NO_COLOR not set", () => {
    delete process.env.NO_COLOR;
    const result = detectColorSupport();
    expect(typeof result).toBe("boolean");
  });
});
