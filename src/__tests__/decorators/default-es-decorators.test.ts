import { Match, Serializer } from "../..";

type SymbolWithMetadata = {
  metadata?: symbol;
};

const symbolWithMetadata = Symbol as unknown as SymbolWithMetadata;

if (symbolWithMetadata.metadata === undefined) {
  symbolWithMetadata.metadata = Symbol("Symbol.metadata");
}

describe("default ES decorators", () => {
  it("supports class schema decorators from the top-level package", () => {
    @Match.Schema()
    class UserDto {
      @Match.Field(Match.NonEmptyString)
      id!: string;
    }

    expect(Match.fromSchema(UserDto).parse({ id: "u1" })).toEqual({
      id: "u1",
    });
  });

  it("supports serializer field remapping from the top-level package", () => {
    @Match.Schema()
    class UserDto {
      @Serializer.Field({ from: "user_id" })
      @Match.Field(Match.NonEmptyString)
      id!: string;
    }

    const serializer = new Serializer();
    const outbound = new UserDto();
    outbound.id = "u1";

    expect(serializer.stringify(outbound)).toBe('{"user_id":"u1"}');
    expect(
      serializer.deserialize('{"user_id":"u1"}', { schema: UserDto }),
    ).toEqual({
      id: "u1",
    });
  });
});
