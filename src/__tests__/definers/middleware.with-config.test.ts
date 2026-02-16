import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { defineResourceMiddleware } from "../../definers/defineResourceMiddleware";

describe("middleware .with(config)", () => {
  describe("defineTaskMiddleware", () => {
    it("preserves config identity when base config is empty", () => {
      const mw = defineTaskMiddleware<{ limit: number }>({
        id: "tests.mw.task.identity",
        run: async ({ next }) => next(),
      });

      const cfg = { limit: 1 };
      const a = mw.with(cfg);
      const b = mw.with(cfg);

      expect(a.config).toBe(cfg);
      expect(b.config).toBe(cfg);
    });

    it("merges config when calling .with() multiple times", () => {
      const mw = defineTaskMiddleware<{ a?: number; b?: number }>({
        id: "tests.mw.task.merge",
        run: async ({ next }) => next(),
      });

      const first = mw.with({ a: 1 });
      const second = first.with({ b: 2 });

      expect(second.config).toEqual({ a: 1, b: 2 });
    });

    it("returns non-object config values as-is", () => {
      const mw = defineTaskMiddleware<number>({
        id: "tests.mw.task.primitive",
        run: async ({ next }) => next(),
      });

      const configured = mw.with(5);
      expect(configured.config).toBe(5);
    });

    it("falls back to the base middleware when with() is called with detached this", () => {
      const mw = defineTaskMiddleware<{ value: number }>({
        id: "tests.mw.task.detached",
        run: async ({ next }) => next(),
      });

      const detachedWith = mw.with;
      const configured = detachedWith.call(undefined, { value: 42 });
      expect(configured.config).toEqual({ value: 42 });
    });
  });

  describe("defineResourceMiddleware", () => {
    it("preserves config identity when base config is empty", () => {
      const mw = defineResourceMiddleware<{ limit: number }>({
        id: "tests.mw.resource.identity",
        run: async ({ next }) => next(),
      });

      const cfg = { limit: 1 };
      const a = mw.with(cfg);
      const b = mw.with(cfg);

      expect(a.config).toBe(cfg);
      expect(b.config).toBe(cfg);
    });

    it("merges config when calling .with() multiple times", () => {
      const mw = defineResourceMiddleware<{ a?: number; b?: number }>({
        id: "tests.mw.resource.merge",
        run: async ({ next }) => next(),
      });

      const first = mw.with({ a: 1 });
      const second = first.with({ b: 2 });

      expect(second.config).toEqual({ a: 1, b: 2 });
    });

    it("returns non-object config values as-is", () => {
      const mw = defineResourceMiddleware<number>({
        id: "tests.mw.resource.primitive",
        run: async ({ next }) => next(),
      });

      const configured = mw.with(5);
      expect(configured.config).toBe(5);
    });

    it("falls back to the base resource middleware when with() is called with detached this", () => {
      const mw = defineResourceMiddleware<{ value: number }>({
        id: "tests.mw.resource.detached",
        run: async ({ next }) => next(),
      });

      const detachedWith = mw.with;
      const configured = detachedWith.call(undefined, { value: 7 });
      expect(configured.config).toEqual({ value: 7 });
    });
  });
});
