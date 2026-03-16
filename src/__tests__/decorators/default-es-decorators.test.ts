import { Match, Serializer } from "../..";

describe("default ES decorators", () => {
  it("supports class schema decorators from the top-level package", () => {
    @Match.Schema()
    class UserDto {
      @Match.Field(Match.NonEmptyString)
      id!: string;
    }

    const parsed = Match.fromSchema(UserDto).parse({ id: "u1" });

    expect(parsed).toBeInstanceOf(UserDto);
    expect(parsed).toEqual({ id: "u1" });
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
    const deserialized = serializer.deserialize('{"user_id":"u1"}', {
      schema: UserDto,
    });

    expect(deserialized).toBeInstanceOf(UserDto);
    expect(deserialized).toEqual({ id: "u1" });
  });
});
