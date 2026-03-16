import { r, resources, tags } from "../../public";
import { run } from "../../run";

describe("cron resource coverage branches", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("accepts task-like `only` entries that are not in the store by falling back to entry.id", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const task = r
      .task("cron-only-object-branch-task")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => undefined)
      .build();

    const app = r
      .resource("cron-only-object-branch-app")
      .register([
        resources.cron.with({
          only: [{ id: "app.tasks.only.object-branch-unknown" } as any],
        }),
        task,
      ])
      .build();

    const runtime = await run(app, {
      logs: {
        printThreshold: "info",
      },
    });
    const cron = runtime.getResourceValue(resources.cron);

    expect(cron.schedules.size).toBe(0);
    expect(
      errorSpy.mock.calls.some((args) =>
        args.some(
          (value) =>
            typeof value === "string" &&
            value.includes("app.tasks.only.object-branch-unknown"),
        ),
      ),
    ).toBe(true);

    await runtime.dispose();
  });
});
