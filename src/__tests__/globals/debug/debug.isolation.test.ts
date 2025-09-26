import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { debugResource } from "../../../globals/resources/debug/debug.resource";
import { debug } from "../../../globals/debug";

const { normal: levelNormal } = debug.levels;

Error.stackTraceLimit = Infinity;

describe("debug config isolation across runs", () => {
  it("does not leak verbose flags into subsequent runs", async () => {
    type Input = { msg: string };

    const logs1: Array<{ level: string; message: any; data?: any }> = [];
    const logs2: Array<{ level: string; message: any; data?: any }> = [];

    const collector1 = defineResource({
      id: "tests.isolation.collector1",
      dependencies: { logger: globalResources.logger },
      async init(_c, { logger }) {
        logger.onLog(async (l) => {
          logs1.push({ level: l.level, message: l.message, data: l.data });
        });
        return true;
      },
    });

    const collector2 = defineResource({
      id: "tests.isolation.collector2",
      dependencies: { logger: globalResources.logger },
      async init(_c, { logger }) {
        logger.onLog(async (l) => {
          logs2.push({ level: l.level, message: l.message, data: l.data });
        });
        return true;
      },
    });

    const task = defineTask<Input, Promise<string>>({
      id: "tests.isolation.task",
      async run(input) {
        return `ok:${input?.msg ?? "none"}`;
      },
    });

    // First run: verbose, should log task input
    const app1 = defineResource({
      id: "tests.isolation.app1",
      register: [debugResource.with("verbose"), collector1, task],
      dependencies: { task, collector1 },
      async init(_c, { task }) {
        await task({ msg: "first" });
        return true;
      },
    });

    await run(app1, {
      logs: { bufferLogs: true, printThreshold: null },
    });

    const start1 = logs1.find((l) =>
      String(l.message).includes("Task tests.isolation.task is running"),
    );
    expect(start1).toBeTruthy();
    expect(start1?.data?.input).toEqual({ msg: "first" });

    // Second run: normal (or explicit flags off), must not log task input
    const configOff = {
      ...levelNormal,
      logTaskInput: false,
      logTaskOutput: false,
    } as const;
    const app2 = defineResource({
      id: "tests.isolation.app2",
      register: [debugResource.with(configOff), collector2, task],
      dependencies: { task, collector2 },
      async init(_c, { task }) {
        await task({ msg: "second" });
        return true;
      },
    });

    await run(app2, {
      logs: { bufferLogs: true, printThreshold: null },
    });

    const start2 = logs2.find((l) =>
      String(l.message).includes("Task tests.isolation.task is running"),
    );
    expect(start2).toBeTruthy();
    expect(start2?.data).toBeUndefined();
  });
});
