import { cronResource } from "../../globals/cron/cron.resource";

describe("cron resource coverage", () => {
  it("resolves `only` object entries from their raw ids when the store cannot canonicalize them", async () => {
    const findIdByDefinition = jest.fn(() => "should-not-be-used");

    const value = await cronResource.init?.(
      {
        only: [{ id: "raw-task-id" } as any],
      } as never,
      {
        cron: { tasks: [] },
        logger: {
          with: () => ({
            info: jest.fn(async () => undefined),
            warn: jest.fn(async () => undefined),
            error: jest.fn(async () => undefined),
          }),
        },
        store: {
          hasDefinition: () => false,
          findIdByDefinition,
        },
        taskRunner: {
          run: jest.fn(async () => undefined),
        },
      } as never,
      { scheduler: undefined } as never,
    );

    expect(findIdByDefinition).not.toHaveBeenCalled();
    expect(value?.schedules.size).toBe(0);
  });
});
