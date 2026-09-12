import {
  createCanonicalId,
  createLocalId,
  createSourceId,
  createStorageId,
} from "../../tools/definitionId";

describe("definition ids", () => {
  it("keeps validated ids as strings across explicit identity boundaries", () => {
    const sourceId = createSourceId("create-user");
    const localId = createLocalId(sourceId);
    const canonicalId = createCanonicalId(`app.tasks.${localId}`);

    expect(sourceId).toBe("create-user");
    expect(localId).toBe("create-user");
    expect(canonicalId).toBe("app.tasks.create-user");
    expect(createStorageId(canonicalId)).toBe(canonicalId);
  });

  it.each([
    ["local", () => createLocalId(createSourceId(""))],
    ["local whitespace", () => createLocalId(createSourceId("  "))],
    ["canonical", () => createCanonicalId("")],
  ])("rejects empty %s ids", (_label, createId) => {
    expect(createId).toThrow(/must be non-empty/i);
  });

  it("rejects qualified ids at the local-id boundary", () => {
    expect(() =>
      createLocalId(createSourceId("app.tasks.create-user")),
    ).toThrow(/Local id .* cannot contain/i);
  });

  it.each([".app", "app.", "app..tasks"])(
    "rejects malformed canonical id %s",
    (id) => {
      expect(() => createCanonicalId(id)).toThrow(
        /cannot start or end with a dot or contain consecutive dots/i,
      );
    },
  );
});
