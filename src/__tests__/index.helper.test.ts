import { defineTask, defineResource, defineIndex } from "../define";
import { run } from "../run";
import { index } from "../index";

describe("index helper", () => {
  it("should aggregate dependencies and expose proper types", async () => {
    const userService = defineResource({
      id: "user.service",
      async init() {
        return "USER";
      },
    });

    const configuredService = defineResource({
      id: "configured.service",
      async init(config: { name: string }) {
        return config.name;
      },
    });

    const getUserTask = defineTask({
      id: "task.getUser",
      dependencies: { userService },
      async run(_, { userService }) {
        return userService;
      },
    });

    // The helper under test
    const services = index({
      userService,
      getUserTask,
      configuredService: configuredService.with({ name: "configured" }),
    });

    const app = defineResource({
      id: "app",
      register: [services],
      dependencies: { services },
      async init(_, { services }) {
        // Runtime assertions
        expect(services.userService).toBe("USER");
        const result = await services.getUserTask();
        expect(result).toBe("USER");
        expect(services.configuredService).toBe("configured");
        // Type assertions
        services.userService as string;
        // @ts-expect-error – assigning to never should error
        const neverValue: never = "bad";
      },
    });

    await run(app);
  });
});
