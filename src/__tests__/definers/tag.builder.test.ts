import { r, definitions } from "../..";

describe("tag builder", () => {
  it("build() returns branded tag with id", () => {
    const tg = r.tag("tests.builder.tag").build();
    // brand
    expect((tg as unknown as Record<symbol, any>)[definitions.symbolTag]).toBe(
      true,
    );
    expect(
      typeof (tg as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toBe("string");
    expect(tg.id).toBe("tests.builder.tag");
  });

  it("supports meta, configSchema, and config; with/exists/extract work", () => {
    const tg = r
      .tag<{ value?: number }>("tests.builder.tag.meta")
      .meta({})
      .configSchema<{ value?: number }>({ parse: (x: any) => x })
      .config({ value: 1 })
      .build();

    const configured = tg.with({ value: 2 });
    const list = [configured];
    expect(tg.exists(list)).toBe(true);
    expect(tg.extract(list)).toEqual({ value: 2 });
  });
});
