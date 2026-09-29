import { r, run } from "../..";
import { ScopedResourceOverrides } from "../../models/overrides/ScopedResourceOverrides";
import { VisibilityTracker } from "../../models/VisibilityTracker";

describe("app-root resource overrides", () => {
  it.each(["dev", "pre-prod", "prod", "test"] as const)(
    "uses one registered instance and skips scope compilation in %s",
    async (mode) => {
      const compile = jest.spyOn(ScopedResourceOverrides.prototype, "compile");
      const recordScope = jest.spyOn(
        VisibilityTracker.prototype,
        "recordScopedResource",
      );
      const original = jest.fn(async () => ({ count: 0 }));
      const replacement = jest.fn(async () => ({ count: 1 }));
      const disposed = jest.fn();
      const service = r
        .resource("service")
        .init(original)
        .dispose(disposed)
        .build();
      const read = r
        .task("read")
        .dependencies({ service })
        .run(async (_, deps) => deps.service)
        .build();
      const child = r.resource("child").register([service, read]).build();
      const app = r
        .resource("entry")
        .register([child])
        .overrides([r.override(service, replacement)])
        .build();
      try {
        const runtime = await run(app, { mode });
        try {
          expect(await runtime.runTask(read)).toBe(
            runtime.getResourceValue(service),
          );
          expect(replacement).toHaveBeenCalledTimes(1);
          expect(original).not.toHaveBeenCalled();
          expect(compile).not.toHaveBeenCalled();
          expect(recordScope).not.toHaveBeenCalled();
          expect(runtime.inspect().explain(service).override).toMatchObject({
            baseCanonicalId: "entry.child.service",
            declaredByResourceId: "entry",
          });
        } finally {
          await runtime.dispose();
        }
        expect(disposed).toHaveBeenCalledTimes(1);
      } finally {
        compile.mockRestore();
        recordScope.mockRestore();
      }
    },
  );

  it("keeps other subtree replacements when applying a global override", async () => {
    const mailer = r
      .resource("mailer")
      .init(async () => "original")
      .build();
    const service = r
      .resource<{ prefix: string }>("service")
      .dependencies({ mailer })
      .init(async (config, deps) => `${config.prefix}:${deps.mailer}`)
      .build();
    const read = r
      .task("read")
      .dependencies({ service, mailer })
      .run(async (_, deps) => deps)
      .build();
    const b = r
      .resource("b")
      .register([service.with({ prefix: "configured" }), read])
      .overrides([r.override(mailer, async () => "b")])
      .build();
    const readOutside = r
      .task("readOutside")
      .dependencies({ service, mailer })
      .run(async (_, deps) => deps)
      .build();
    const app = r
      .resource("app")
      .register([mailer, b, readOutside])
      .overrides([
        r.override(
          service,
          async (config, deps) => `${config.prefix}:root:${deps.mailer}`,
        ),
      ])
      .build();
    const runtime = await run(app);
    try {
      expect(await runtime.runTask(read)).toEqual({
        service: "configured:root:b",
        mailer: "b",
      });
      expect(await runtime.runTask(readOutside)).toEqual({
        service: "configured:root:b",
        mailer: "original",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
