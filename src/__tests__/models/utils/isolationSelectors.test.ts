import {
  compileIsolationSelectorPattern,
  isWildcardSelector,
  resolveIsolationSelector,
} from "../../../models/utils/isolationSelectors";

describe("isolationSelectors", () => {
  it("detects wildcard selectors", () => {
    expect(isWildcardSelector("app.resources.*")).toBe(true);
    expect(isWildcardSelector("app-resources-db")).toBe(false);
  });

  it("compiles segment wildcard selectors", () => {
    const matcher = compileIsolationSelectorPattern("app.resources.*");

    expect(matcher.test("app.resources.db")).toBe(true);
    expect(matcher.test("app.resources.db.read")).toBe(false);
    expect(matcher.test("app.services.db")).toBe(false);
  });

  it("resolves exact ids before wildcard expansion", () => {
    const registeredIds = new Set(["app.resources.*", "app.resources.db"]);

    expect(resolveIsolationSelector("app.resources.*", registeredIds)).toEqual([
      "app.resources.*",
    ]);
  });

  it("expands wildcard selectors to matching ids", () => {
    const registeredIds = new Set([
      "app.resources.db",
      "app.resources.cache",
      "app.resources.db.test",
      "app.events.ready",
    ]);

    expect(resolveIsolationSelector("app.resources.*", registeredIds)).toEqual([
      "app.resources.db",
      "app.resources.cache",
    ]);
  });

  it("returns empty list for non-wildcard unknown ids", () => {
    const registeredIds = new Set(["app.resources.db"]);

    expect(
      resolveIsolationSelector("app.resources.cache", registeredIds),
    ).toEqual([]);
  });
});
