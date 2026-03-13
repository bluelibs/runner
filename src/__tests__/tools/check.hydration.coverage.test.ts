import { Match } from "../../decorators/legacy";
import { hydrateMatchedValue } from "../../tools/check/hydration";
import {
  copyHydratedProperty,
  getHydratedReference,
  getSeenHydratedValue,
  patternCanHydrate,
  rememberHydratedValue,
} from "../../tools/check/hydration.helpers";

describe("tools/check hydration coverage", () => {
  class UserDto {
    public id!: string;
    public self?: UserDto;
  }

  beforeAll(() => {
    Match.Schema()(UserDto);
    Match.Field(Match.NonEmptyString)(UserDto.prototype, "id");
    Match.Field(Match.Optional(Match.fromSchema(() => UserDto)))(
      UserDto.prototype,
      "self",
    );
  });

  it("covers hydration helpers and circular seen references", () => {
    const target = {};
    copyHydratedProperty(target, "id", "u1");
    expect(target).toEqual({ id: "u1" });

    const seen = new WeakMap<object, unknown>();
    const source = {};

    expect(getHydratedReference("x", seen)).toBe("x");
    expect(getSeenHydratedValue("x", seen)).toBeUndefined();

    rememberHydratedValue("x", target, seen);
    expect(getSeenHydratedValue("x", seen)).toBeUndefined();

    rememberHydratedValue(source, target, seen);
    expect(getHydratedReference(source, seen)).toBe(target);
    expect(getSeenHydratedValue(source, seen)).toBe(target);

    const unseenObject = {};
    expect(getHydratedReference(unseenObject, seen)).toBe(unseenObject);
  });

  it("covers pattern detection guard branches", () => {
    const selfLazy = Match.Lazy(() => Match.fromSchema(UserDto));
    const activePatterns = new WeakSet<object>();
    activePatterns.add(selfLazy);
    expect(patternCanHydrate(selfLazy, new WeakSet<object>(), 0)).toBe(false);
    expect(patternCanHydrate(selfLazy, activePatterns)).toBe(false);

    const selfObject: Record<string, unknown> = {};
    selfObject.self = selfObject;
    expect(patternCanHydrate(selfObject)).toBe(false);
  });

  it("covers wrapper, union, array, map, and plain-object hydration branches", () => {
    const wrapped = Match.WithErrorPolicy(
      Match.WithMessage(
        Match.Optional(Match.fromSchema(UserDto)),
        "wrapped user invalid",
      ),
      "all",
    );

    const hydratedWrapped = hydrateMatchedValue({ id: "u1" }, wrapped);
    expect(hydratedWrapped).toBeInstanceOf(UserDto);

    expect(hydrateMatchedValue(null, Match.fromSchema(UserDto))).toBeNull();

    const nonPlainArray = [{ id: "u1" }];
    expect(hydrateMatchedValue(nonPlainArray, Match.fromSchema(UserDto))).toBe(
      nonPlainArray,
    );

    const unmatchedUnion = Match.OneOf(Match.fromSchema(UserDto), Boolean);
    expect(hydrateMatchedValue("nope", unmatchedUnion)).toBe("nope");
    expect(
      hydrateMatchedValue(
        { id: "u-one-of" },
        Match.OneOf(Match.fromSchema(UserDto), Boolean),
      ),
    ).toBeInstanceOf(UserDto);

    const hydratedNonEmptyArray = hydrateMatchedValue(
      [{ id: "u-non-empty" }],
      Match.NonEmptyArray(Match.fromSchema(UserDto)),
    ) as Array<unknown>;
    expect(hydratedNonEmptyArray[0]).toBeInstanceOf(UserDto);

    const sourceArray = [{ id: "u-array" }];
    const existingArray: unknown[] = [];
    expect(
      hydrateMatchedValue(
        sourceArray,
        Match.ArrayOf(Match.fromSchema(UserDto)),
        {
          seen: new WeakMap<object, unknown>([[sourceArray, existingArray]]),
        } as never,
      ),
    ).toBe(existingArray);

    const recursiveMap = Object.assign(Object.create(null), {
      user: { id: "u2" },
    }) as Record<string, unknown>;
    const existingMap = Object.create(null) as Record<string, unknown>;
    const mapPattern = Match.MapOf(
      Match.OneOf(
        Match.fromSchema(UserDto),
        Match.ObjectIncluding({
          user: Match.Optional(Match.fromSchema(UserDto)),
          self: Match.Optional(Match.Any),
        }),
      ),
    );
    const hydratedMap = hydrateMatchedValue(recursiveMap, mapPattern, {
      seen: new WeakMap<object, unknown>([[recursiveMap, existingMap]]),
    } as never) as Record<string, unknown>;
    expect(Object.getPrototypeOf(hydratedMap)).toBeNull();
    expect(hydratedMap).toBe(existingMap);

    const freshMap = Object.assign(Object.create(null), {
      user: { id: "u-map" },
    }) as Record<string, unknown>;
    const hydratedFreshMap = hydrateMatchedValue(
      freshMap,
      Match.MapOf(Match.fromSchema(UserDto)),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(hydratedFreshMap)).toBeNull();
    expect(hydratedFreshMap.user).toBeInstanceOf(UserDto);

    const objectIncludingValue = { user: { id: "u3" } };
    const hydratedIncluding = hydrateMatchedValue(
      objectIncludingValue,
      Match.ObjectIncluding({ user: Match.fromSchema(UserDto) }),
    ) as Record<string, unknown>;
    expect(hydratedIncluding.user).toBeInstanceOf(UserDto);

    const objectStrictValue = { user: { id: "u4" } };
    const hydratedStrict = hydrateMatchedValue(
      objectStrictValue,
      Match.ObjectStrict({ user: Match.fromSchema(UserDto) }),
    ) as Record<string, unknown>;
    expect(hydratedStrict.user).toBeInstanceOf(UserDto);

    const plainObjectValue = { user: { id: "u5" } };
    const hydratedPlain = hydrateMatchedValue(plainObjectValue, {
      user: Match.fromSchema(UserDto),
    }) as Record<string, unknown>;
    expect(hydratedPlain.user).toBeInstanceOf(UserDto);
    expect(
      hydrateMatchedValue(
        plainObjectValue,
        { user: Match.fromSchema(UserDto) },
        {
          seen: new WeakMap<object, unknown>([
            [plainObjectValue, hydratedPlain],
          ]),
        } as never,
      ),
    ).toBe(hydratedPlain);

    expect(
      hydrateMatchedValue("bad-map", Match.MapOf(Match.fromSchema(UserDto))),
    ).toBe("bad-map");
    expect(
      hydrateMatchedValue(
        "bad-object",
        Match.ObjectIncluding({ user: Match.fromSchema(UserDto) }),
      ),
    ).toBe("bad-object");
    expect(
      hydrateMatchedValue(
        "bad-object",
        Match.ObjectStrict({ user: Match.fromSchema(UserDto) }),
      ),
    ).toBe("bad-object");
    expect(
      hydrateMatchedValue("bad-object", { user: Match.fromSchema(UserDto) }),
    ).toBe("bad-object");
    expect(
      hydrateMatchedValue(
        "bad-array",
        Match.ArrayOf(Match.fromSchema(UserDto)),
      ),
    ).toBe("bad-array");
    expect(
      hydrateMatchedValue(
        "bad-array",
        Match.NonEmptyArray(Match.fromSchema(UserDto)),
      ),
    ).toBe("bad-array");

    const proxyPattern = new Proxy(
      { user: Match.fromSchema(UserDto) },
      {
        getPrototypeOf: () => Date.prototype,
      },
    );
    const proxyValue = { user: { id: "u-proxy" } };
    expect(hydrateMatchedValue(proxyValue, proxyPattern)).toBe(proxyValue);
  });
});
