import { defineResource, defineTask, run } from "../..";
import { Match } from "../../decorators/legacy";

describe("tools/check hydration", () => {
  it("hydrates decorated class schemas by default on parse", () => {
    class UserDto {
      public id!: string;
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

    const parsed = Match.fromSchema(UserDto).parse({ id: "u1" });

    expect(parsed).toBeInstanceOf(UserDto);
    expect(parsed).toEqual({ id: "u1" });
  });

  it("accepts already-hydrated instances for class schema parsing", () => {
    class UserDto {
      public id!: string;
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

    const user = new UserDto();
    user.id = "u1";

    expect(Match.fromSchema(UserDto).parse(user)).toBe(user);
  });

  it("hydrates nested class-schema elements while leaving parent plain objects alone", () => {
    class UserDto {
      public id!: string;
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

    const parsed = Match.compile({
      user: Match.fromSchema(UserDto),
      meta: Match.ObjectIncluding({ ok: Boolean }),
    }).parse({
      user: { id: "u1" },
      meta: { ok: true },
    });

    expect(parsed.user).toBeInstanceOf(UserDto);
    expect(parsed.meta).not.toBeInstanceOf(UserDto);
    expect(parsed).toEqual({
      user: { id: "u1" },
      meta: { ok: true },
    });
  });

  it("preserves MapOf source prototypes while hydrating entries", () => {
    class UserDto {
      public id!: string;
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");

    const source = { user: { id: "u1" } };
    const parsed = Match.compile({
      users: Match.MapOf(Match.fromSchema(UserDto)),
    }).parse({ users: source }) as {
      users: Record<string, unknown>;
    };

    expect(Object.getPrototypeOf(parsed.users)).toBe(
      Object.getPrototypeOf(source),
    );
    expect(parsed.users.user).toBeInstanceOf(UserDto);
  });

  it("preserves self-references when hydrating recursive class schemas", () => {
    class UserDto {
      public id!: string;
      public self!: UserDto;
      public children!: UserDto[];
    }

    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");
    Match.Field(Match.fromSchema(() => UserDto))(UserDto.prototype, "self");
    Match.Field(Match.ArrayOf(Match.fromSchema(() => UserDto)))(
      UserDto.prototype,
      "children",
    );

    const payload: Record<string, unknown> = {
      id: "root",
      children: [{ id: "child", children: [] }],
    };
    const childPayload = (
      payload.children as Array<Record<string, unknown>>
    )[0];
    payload.self = payload;
    childPayload.self = childPayload;

    const parsed = Match.fromSchema(UserDto).parse(payload);

    expect(parsed).toBeInstanceOf(UserDto);
    expect(parsed.self).toBe(parsed);
    expect(parsed.children[0]).toBeInstanceOf(UserDto);
    expect(parsed.children[0].self).toBe(parsed.children[0]);
  });

  it("hydrates class-shorthand task inputs across schema() callsites", async () => {
    class InputDto {
      public value!: string;
    }

    Match.Schema()(InputDto);
    Match.Field(Match.NonEmptyString)(InputDto.prototype, "value");

    const task = defineTask({
      id: "tests-schema-hydration-task",
      inputSchema: InputDto,
      run: async (input) => ({
        isInstance: input instanceof InputDto,
        value: input.value,
      }),
    });

    const app = defineResource({
      id: "tests-schema-hydration-app",
      register: [task],
    });
    const runtime = await run(app);

    await expect(runtime.runTask(task, { value: "ok" })).resolves.toEqual({
      isInstance: true,
      value: "ok",
    });

    await runtime.dispose();
  });
});
