import { cronResource } from "../../globals/cron/cron.resource";

describe("global cron resource resolveDefinitionId coverage", () => {
  it("falls back to object ids when unregistered `only` entries are objects", async () => {
    const store = {
      hasDefinition: jest.fn(() => false),
      findIdByDefinition: jest.fn((entry: unknown) => String(entry)),
    };
    const logger = {
      with: jest.fn(() => ({
        info: jest.fn(async () => undefined),
        warn: jest.fn(async () => undefined),
        error: jest.fn(async () => undefined),
      })),
    };
    const context = {
      scheduler: undefined,
    };

    await cronResource.init?.(
      {
        only: [{ id: "plain.task.id" }],
      } as never,
      {
        cron: { tasks: [] },
        logger,
        store,
        taskRunner: { run: jest.fn(async () => undefined) },
      } as never,
      context as never,
    );

    expect(context.scheduler).toBeDefined();
    expect(store.hasDefinition).toHaveBeenCalledWith({ id: "plain.task.id" });
    expect(store.findIdByDefinition).not.toHaveBeenCalled();

    await cronResource.dispose?.(
      undefined as never,
      undefined as never,
      {} as never,
      context as never,
    );
  });
});
