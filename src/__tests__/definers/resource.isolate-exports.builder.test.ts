import { r } from "../..";

describe("resource builder: isolate.exports", () => {
  it("appends isolate.exports arrays by default", () => {
    const a = r
      .task("tests-isolate-exports-append-a")
      .run(async () => undefined)
      .build();
    const b = r
      .task("tests-isolate-exports-append-b")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-append-resource")
      .register([a, b])
      .isolate({ exports: [a] })
      .isolate({ exports: [b] })
      .build();

    expect(res.isolate).toEqual({ exports: [a, b] });
  });

  it("supports isolate.exports override mode", () => {
    const a = r
      .task("tests-isolate-exports-override-a")
      .run(async () => undefined)
      .build();
    const b = r
      .task("tests-isolate-exports-override-b")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-override-resource")
      .register([a, b])
      .isolate({ exports: [a] })
      .isolate({ exports: [b] }, { override: true })
      .build();

    expect(res.isolate).toEqual({ exports: [b] });
  });

  it('supports isolate.exports = "none"', () => {
    const a = r
      .task("tests-isolate-exports-none-a")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-none-resource")
      .register([a])
      .isolate({ exports: "none" })
      .build();

    expect(res.isolate).toEqual({ exports: "none" });
  });

  it('replaces isolate.exports when prior value is "none"', () => {
    const a = r
      .task("tests-isolate-exports-none-replace-a")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-none-replace-resource")
      .register([a])
      .isolate({ exports: "none" })
      .isolate({ exports: [a] })
      .build();

    expect(res.isolate).toEqual({ exports: [a] });
  });

  it("keeps existing isolate.exports when isolate call omits exports", () => {
    const a = r
      .task("tests-isolate-exports-keep-a")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-keep-resource")
      .register([a])
      .isolate({ exports: [a] })
      .isolate({ deny: [] })
      .build();

    expect(res.isolate).toEqual({ deny: [], exports: [a] });
  });

  it("treats unexpected existing isolate.exports type as replace-on-next-array", () => {
    const a = r
      .task("tests-isolate-exports-unexpected-a")
      .run(async () => undefined)
      .build();

    const res = r
      .resource("tests-isolate-exports-unexpected-resource")
      .register([a])
      .isolate({ exports: 123 as any })
      .isolate({ exports: [a] })
      .build();

    expect(res.isolate).toEqual({ exports: [a] });
  });
});
