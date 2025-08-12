import { defineResource, defineTask } from "../define";
import { run } from "../run";

describe("schema validation", () => {
  it("validates task input and passes transformed value to run and afterRun", async () => {
    const seen: any = { before: undefined, run: undefined, after: undefined };

    const t = defineTask({
      id: "validation.task",
      inputSchema: {
        parse(value: unknown) {
          const v = value as any;
          if (typeof v !== "string" || !v.trim()) {
            throw new Error("Invalid input");
          }
          return v.trim().toUpperCase();
        },
      },
      run: async (input: string) => {
        seen.run = input;
        return input + "!";
      },
    });

    const app = defineResource({
      id: "app.validation.task",
      register: [t],
      dependencies: { t },
      async init(_, { t }) {
        return await t("  hello ");
      },
    });

    const { value } = await run(app);
    expect(value).toBe("HELLO!");
    expect(seen.run).toBe("HELLO");
  });

  it("routes task input validation errors through onError", async () => {
    const errSpy = jest.fn();
    const t = defineTask({
      id: "validation.task.error",
      inputSchema: (v: unknown) => {
        throw Object.assign(new Error("bad"), { issues: [{ code: "custom" }] });
      },
      run: async (_input: string) => "ok",
    });

    const handler = defineTask({
      on: t.events.onError,
      run: async (e) => {
        errSpy(e.data.error);
      },
    });

    const app = defineResource({
      id: "app.validation.task.error",
      register: [t, handler],
      dependencies: { t },
      async init(_, { t }) {
        try {
          await t("x");
        } catch {}
      },
    });

    await run(app).catch(() => {});
    expect(errSpy).toHaveBeenCalled();
    const err = errSpy.mock.calls[0][0];
    expect(err.kind).toBe("task.input");
    expect(err.targetId).toBe("validation.task.error");
  });

  it("validates resource config and passes transformed config to init", async () => {
    let seenConfig: any;
    const r = defineResource<{ port: number }>({
      id: "validation.resource",
      configSchema: {
        parse(value: unknown) {
          const v = value as any;
          if (
            !v ||
            typeof v !== "object" ||
            typeof (v as any).port !== "number"
          ) {
            throw new Error("invalid config");
          }
          return { ...v, port: (v as any).port + 1 };
        },
      },
      async init(config) {
        seenConfig = config;
        return config.port;
      },
    });

    const app = defineResource({
      id: "app.validation.resource",
      register: [r.with({ port: 3000 })],
      dependencies: { r },
      async init(_, { r }) {
        return r;
      },
    });

    const { value } = await run(app);
    expect(value).toBe(3001);
    expect(seenConfig).toEqual({ port: 3001 });
  });

  it("routes resource config validation errors through onError", async () => {
    const errSpy = jest.fn();
    const r = defineResource<{}>({
      id: "validation.resource.error",
      configSchema: () => {
        const e: any = new Error("invalid");
        e.details = { reason: "nope" };
        throw e;
      },
      async init() {
        return 1;
      },
    });

    const handler = defineTask({
      on: r.events.onError,
      run: async (e) => {
        errSpy(e.data.error);
        e.data.suppress();
      },
    });

    const app = defineResource({
      id: "app.validation.resource.error",
      register: [r.with({}), handler],
      dependencies: { r },
      async init(_, { r }) {
        return r;
      },
    });

    await run(app);
    expect(errSpy).toHaveBeenCalled();
    const err = errSpy.mock.calls[0][0];
    expect(err.kind).toBe("resource.config");
    expect(err.targetId).toBe("validation.resource.error");
  });
});
