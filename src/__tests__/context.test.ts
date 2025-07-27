import { createContext, task, run, provideContext, resource } from "../index";
import { ContextError } from "../context";

describe("Context System", () => {
  const TestContext = createContext<{ id: string }>();

  test("useContext throws when missing", async () => {
    const r = resource({
      id: "test.context.use",
      init: async () => TestContext.use(),
    });

    await expect(run(r)).rejects.toThrow(ContextError);

    await provideContext(TestContext, { id: "1" }, async () => {
      await expect(run(r)).resolves.toEqual({
        value: { id: "1" },
        dispose: expect.any(Function),
      });
    });
  });

  test("require middleware blocks missing context", async () => {
    const t = task({
      id: "task",
      middleware: [TestContext.require()],
      run: async () => "ok",
    });

    const r = resource({
      id: "resource",
      register: [t],
      dependencies: { t },
      init: async (_, deps) => deps.t(),
    });
    await expect(run(r)).rejects.toThrow(ContextError);

    await provideContext(TestContext, { id: "1" }, async () => {
      await expect(run(r)).resolves.toEqual({
        value: "ok",
        dispose: expect.any(Function),
      });
    });
  });
});
