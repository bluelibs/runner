import * as esDecorators from "../../decorators/es";
import * as legacyDecorators from "../../decorators/legacy";

describe("decorator entrypoints", () => {
  it("exports ES decorators from the explicit ES subpath", () => {
    expect(esDecorators.Match).toBeDefined();
    expect(typeof esDecorators.Match.Schema).toBe("function");
    expect(typeof esDecorators.Serializer.Field).toBe("function");
  });

  it("exports legacy decorators from the legacy subpath", () => {
    expect(legacyDecorators.Match).toBeDefined();
    expect(typeof legacyDecorators.Match.Schema).toBe("function");
    expect(typeof legacyDecorators.Serializer.Field).toBe("function");
  });
});
