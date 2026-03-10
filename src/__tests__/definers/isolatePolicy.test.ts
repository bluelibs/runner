import {
  assertIsolationConflict,
  createDisplayIsolatePolicy,
  mergeIsolationPolicy,
  mergeLegacyExportsIntoIsolationInput,
  resolveIsolatePolicyDeclarations,
} from "../../definers/isolatePolicy";
import { r } from "../..";

describe("isolatePolicy helpers", () => {
  it("preserves existing deny entries and throws on merged deny/only conflicts", () => {
    const denied = r
      .task("tests-isolatePolicy-denied")
      .run(async () => 1)
      .build();
    const allowed = r
      .task("tests-isolatePolicy-allowed")
      .run(async () => 2)
      .build();

    expect(mergeIsolationPolicy({ deny: [denied] }, {})).toEqual({
      deny: [denied],
    });

    expect(
      mergeIsolationPolicy(
        { deny: { invalid: true } as any },
        { deny: [denied] },
      ),
    ).toEqual({
      deny: { invalid: true },
    });

    expect(
      mergeIsolationPolicy(
        { deny: [denied] },
        { deny: [allowed] },
        { override: true },
      ),
    ).toEqual({
      deny: [allowed],
    });

    expect(
      mergeIsolationPolicy(
        { whitelist: { invalid: true } as any },
        { whitelist: [{ for: [denied], targets: [allowed] }] },
      ),
    ).toEqual({
      whitelist: { invalid: true },
    });

    expect(
      mergeIsolationPolicy(
        undefined,
        { whitelist: [{ for: [denied], targets: [allowed] }] },
        { override: true },
      ),
    ).toEqual({
      whitelist: [{ for: [denied], targets: [allowed] }],
    });

    expect(() =>
      mergeIsolationPolicy({ deny: [denied] }, { only: [allowed] }),
    ).toThrow(
      expect.objectContaining({ id: "runner.errors.isolationConflict" }),
    );
  });

  it("asserts conflicts for static builder-style composition", () => {
    const denied = r
      .task("tests-isolatePolicy-static-denied")
      .run(async () => 1)
      .build();
    const allowed = r
      .task("tests-isolatePolicy-static-allowed")
      .run(async () => 2)
      .build();

    expect(() =>
      assertIsolationConflict(
        "tests-isolatePolicy-resource",
        { deny: [denied] },
        { only: [allowed] },
      ),
    ).toThrow(
      expect.objectContaining({ id: "runner.errors.isolationConflict" }),
    );

    expect(() =>
      assertIsolationConflict(
        "tests-isolatePolicy-resource",
        { deny: [] },
        { only: [allowed] },
      ),
    ).toThrow(
      expect.objectContaining({ id: "runner.errors.isolationConflict" }),
    );
  });

  it("creates a dynamic display policy when declarations include config-driven entries", () => {
    const denied = r
      .task("tests-isolatePolicy-display-denied")
      .run(async () => 1)
      .build();
    const allowed = r
      .task("tests-isolatePolicy-display-allowed")
      .run(async () => 2)
      .build();
    const display = createDisplayIsolatePolicy([
      { policy: { deny: [denied] } },
      {
        policy: (config: { strict: boolean }) => ({
          exports: config.strict ? [allowed] : "none",
        }),
      },
    ]);

    expect(typeof display).toBe("function");
    if (typeof display !== "function") {
      return;
    }

    expect(display({ strict: true })).toEqual({
      deny: [denied],
      exports: [allowed],
    });
    expect(display({ strict: false })).toEqual({
      deny: [denied],
      exports: "none",
    });
  });

  it("resolves undefined when isolate declarations are missing", () => {
    expect(resolveIsolatePolicyDeclarations(undefined, {})).toBeUndefined();
    expect(createDisplayIsolatePolicy(undefined)).toBeUndefined();
  });

  it("preserves malformed multi-call deny and whitelist declarations for later validation", () => {
    const malformedDisplay = createDisplayIsolatePolicy(
      [{ policy: { whitelist: { bad: true } as any } }, { policy: {} }],
      "tests-isolatePolicy-invalid-display",
    );

    expect(malformedDisplay).toEqual({
      whitelist: { bad: true },
    });

    expect(
      resolveIsolatePolicyDeclarations(
        [{ policy: { deny: { bad: true } as any } }, { policy: {} }],
        {},
        "tests-isolatePolicy-invalid-resolve",
      ),
    ).toEqual({
      deny: { bad: true },
    });
  });

  it("keeps the owning resource id when merged declarations conflict", () => {
    const denied = r
      .task("tests-isolatePolicy-conflict-id-denied")
      .run(async () => 1)
      .build();
    const allowed = r
      .task("tests-isolatePolicy-conflict-id-allowed")
      .run(async () => 2)
      .build();

    expect(() =>
      resolveIsolatePolicyDeclarations(
        [
          { policy: { deny: [denied] } },
          { policy: () => ({ only: [allowed] }) },
        ],
        {},
        "tests-isolatePolicy-conflict-id-resource",
      ),
    ).toThrow(
      expect.objectContaining({
        id: "runner.errors.isolationConflict",
        message: expect.stringContaining(
          '"tests-isolatePolicy-conflict-id-resource"',
        ),
      }),
    );
  });

  it("merges legacy exports into dynamic isolate callbacks", () => {
    const exported = r
      .task("tests-isolatePolicy-exported")
      .run(async () => 1)
      .build();
    const isolate = mergeLegacyExportsIntoIsolationInput(
      "tests-isolatePolicy-legacy",
      [exported],
      () => ({ deny: [] }),
    );

    expect(typeof isolate).toBe("function");
    if (typeof isolate !== "function") {
      return;
    }

    expect(isolate({})).toEqual({
      deny: [],
      exports: [exported],
    });
  });

  it("throws when dynamic isolate and legacy exports both declare exports", () => {
    const exported = r
      .task("tests-isolatePolicy-conflict")
      .run(async () => 1)
      .build();
    const isolate = mergeLegacyExportsIntoIsolationInput(
      "tests-isolatePolicy-conflict-resource",
      [exported],
      () => ({ exports: [exported] }),
    );

    expect(typeof isolate).toBe("function");
    if (typeof isolate !== "function") {
      return;
    }

    expect(() => isolate({})).toThrow(
      expect.objectContaining({ id: "runner.errors.isolateExportsConflict" }),
    );
  });
});
