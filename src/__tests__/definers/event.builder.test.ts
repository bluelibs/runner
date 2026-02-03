import { definitions, r } from "../..";

describe("event builder", () => {
  it("builds events with payload schema, meta, and parallel toggle", () => {
    const schema = { parse: (input: unknown) => input };

    const ev = r
      .event("tests.builder.event.base")
      .payloadSchema(schema)
      .meta({ title: "unit" })
      .parallel(false)
      .build();

    expect(ev.id).toBe("tests.builder.event.base");
    expect(ev.payloadSchema).toBe(schema);
    expect(ev.meta).toEqual({ title: "unit" });
    expect(ev.parallel).toBe(false);
    expect(
      (ev as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toContain("event.builder.test");

    const evDefaultParallel = r
      .event("tests.builder.event.parallel.default")
      .parallel()
      .build();

    expect(evDefaultParallel.parallel).toBe(true);
  });

  it("appends tags by default and overrides when requested", () => {
    const tagA = r.tag("tests.builder.event.tags.a").build();
    const tagB = r.tag("tests.builder.event.tags.b").build();
    const tagC = r.tag("tests.builder.event.tags.c").build();
    const tagD = r.tag("tests.builder.event.tags.d").build();

    const append = r
      .event("tests.builder.event.tags.append")
      .tags([tagA])
      .tags([tagB], { override: false })
      .build();

    expect(append.tags).toEqual([tagA, tagB]);

    const override = r
      .event("tests.builder.event.tags.override")
      .tags([tagA])
      .tags([tagC], { override: true })
      .build();

    expect(override.tags).toEqual([tagC]);

    const defaulted = r
      .event("tests.builder.event.tags.defaulted")
      .tags([tagD], {})
      .build();

    expect(defaulted.tags).toEqual([tagD]);
  });
});
