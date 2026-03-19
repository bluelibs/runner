import { resources, Serializer } from "../../public";
import { Match } from "../../decorators/legacy";
import { RunnerError } from "../../definers/defineError";

describe("global serializer resource config", () => {
  it("exposes a config schema for configured serializer entries", () => {
    expect(resources.serializer.configSchema).toBeDefined();
  });

  it("builds serializer instances from default resource config", async () => {
    const initSerializer = resources.serializer.init;

    expect(initSerializer).toBeDefined();

    const serializer = await initSerializer!(undefined as never, {}, undefined);
    const payload = serializer.stringify({
      metadata: new Map([["ok", true]]),
    });

    expect(serializer.parse(payload)).toEqual({
      metadata: new Map([["ok", true]]),
    });
  });

  it("builds serializer instances from explicit resource config", async () => {
    const parsedConfig = resources.serializer.configSchema?.parse({
      pretty: true,
      allowedTypes: ["Date"],
      symbolPolicy: "disabled",
    });
    const initSerializer = resources.serializer.init;

    expect(parsedConfig).toEqual({
      pretty: true,
      allowedTypes: ["Date"],
      symbolPolicy: "disabled",
    });
    expect(initSerializer).toBeDefined();

    const serializer = await initSerializer!(parsedConfig!, {}, undefined);
    const payload = serializer.stringify({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const blockedPayload = new Serializer().stringify({
      metadata: new Map([["ok", true]]),
    });

    expect(payload).toContain("\n");
    expect(serializer.parse(payload)).toEqual({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(() => serializer.parse(blockedPayload)).toThrow(RunnerError);
  });

  it("builds serializer instances from resource config with types and schemas", async () => {
    class UserDto {
      public id!: string;
    }

    class Box {
      constructor(public readonly value: string) {}
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

    const parsedConfig = resources.serializer.configSchema?.parse({
      schemas: [UserDto],
      types: [
        {
          id: "tests.serializer.Box",
          is: (value: unknown): value is Box => value instanceof Box,
          serialize: (value: Box) => ({ value: value.value }),
          deserialize: (value: { value: string }) => new Box(value.value),
          strategy: "value" as const,
        },
      ],
    });
    const serializer = await resources.serializer.init!(
      parsedConfig!,
      {},
      undefined,
    );
    const payload = serializer.stringify({
      user: Object.assign(new UserDto(), { id: "u1" }),
      box: new Box("fragile"),
    });
    const deserialized = serializer.parse<{
      user: UserDto;
      box: Box;
    }>(payload);

    expect(deserialized.user).toBeInstanceOf(UserDto);
    expect(deserialized.user).toEqual({ id: "u1" });
    expect(deserialized.box).toBeInstanceOf(Box);
    expect(deserialized.box).toEqual({ value: "fragile" });
  });
});
