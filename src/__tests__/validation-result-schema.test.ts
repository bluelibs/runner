import { defineTask, defineResource, defineMiddleware } from "../define";
import { run } from "../run";
import { IValidationSchema } from "../defs";

class MockValidationSchema<T> implements IValidationSchema<T> {
  constructor(private validator: (input: unknown) => T) {}
  parse(input: unknown): T {
    return this.validator(input);
  }
}

describe("Result Schema Validation", () => {
  describe("Task resultSchema", () => {
    it("validates successful result and passes through", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.ok !== "boolean") {
          throw new Error("expected { ok: boolean }");
        }
        return v as { ok: boolean };
      });

      const t = defineTask({
        id: "tests.result.task.ok",
        resultSchema,
        async run() {
          return { ok: true };
        },
      });

      const app = defineResource({
        id: "app",
        register: [t],
        dependencies: { t },
        async init(_, { t }) {
          const r = await t();
          expect(r).toEqual({ ok: true });
          return r;
        },
      });

      await run(app);
    });

    it("throws when result is invalid", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.ok !== "boolean") {
          throw new Error("expected { ok: boolean }");
        }
        return v as { ok: boolean };
      });

      const t = defineTask({
        id: "tests.result.task.invalid",
        resultSchema,
        async run() {
          return { nope: true } as any;
        },
      });

      const app = defineResource({
        id: "app",
        register: [t],
        dependencies: { t },
        async init(_, { t }) {
          await t();
        },
      });

      await expect(run(app)).rejects.toThrow(/Task result validation failed/);
    });

    it("does not validate middleware-returned values (validation happens before middleware)", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.ok !== "boolean") {
          throw new Error("expected { ok: boolean }");
        }
        return v as { ok: boolean };
      });

      const mw = defineMiddleware({
        id: "tests.result.mw.task",
        async run({ next }) {
          const base = await next();
          // Return an invalid shape w.r.t. resultSchema; should not be re-validated
          expect(base).toEqual({ ok: true });
          return { invalid: true } as any;
        },
      });

      const t = defineTask({
        id: "tests.result.task.middleware",
        resultSchema,
        middleware: [mw],
        async run() {
          return { ok: true };
        },
      });

      const app = defineResource({
        id: "app",
        register: [mw, t],
        dependencies: { t },
        async init(_, { t }) {
          const r = await t();
          // If middleware's return was re-validated, this would throw. It should pass.
          expect(r).toEqual({ invalid: true });
          return r;
        },
      });

      await run(app);
    });
  });

  describe("Resource resultSchema", () => {
    it("validates successful resource value", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.connected !== "boolean") {
          throw new Error("expected { connected: boolean }");
        }
        return v as { connected: boolean };
      });

      const r = defineResource({
        id: "tests.result.resource.ok",
        resultSchema,
        async init() {
          return { connected: true };
        },
      });

      const app = defineResource({
        id: "app",
        register: [r],
        dependencies: { r },
        async init(_, { r }) {
          expect(r.connected).toBe(true);
          return r;
        },
      });

      await run(app);
    });

    it("throws when resource value is invalid", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.connected !== "boolean") {
          throw new Error("expected { connected: boolean }");
        }
        return v as { connected: boolean };
      });

      const r = defineResource({
        id: "tests.result.resource.invalid",
        resultSchema,
        async init() {
          return { nope: true } as any;
        },
      });

      await expect(run(r)).rejects.toThrow(/Resource result validation failed/);
    });

    it("does not validate middleware-returned values (validation happens before resource middleware)", async () => {
      const resultSchema = new MockValidationSchema((value: unknown) => {
        const v = value as any;
        if (!v || typeof v.connected !== "boolean") {
          throw new Error("expected { connected: boolean }");
        }
        return v as { connected: boolean };
      });

      const mw = defineMiddleware({
        id: "tests.result.mw.resource",
        async run({ next }) {
          const base = await next();
          expect(base).toEqual({ connected: true });
          return { broken: true } as any;
        },
      });

      const r = defineResource({
        id: "tests.result.resource.middleware",
        resultSchema,
        middleware: [mw],
        async init() {
          return { connected: true };
        },
      });

      const app = defineResource({
        id: "app",
        register: [mw, r],
        dependencies: { r },
        async init(_, { r }) {
          // Should receive middleware-modified value without validation error
          expect((r as any).broken).toBe(true);
          return r as any;
        },
      });

      await run(app);
    });
  });
});
