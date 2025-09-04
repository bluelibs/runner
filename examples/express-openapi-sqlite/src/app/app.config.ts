import { globals, resource } from "@bluelibs/runner";

export const appConfig = resource({
  id: "app.modules.config",
  dependencies: {
    logger: globals.resources.logger,
  },
  init: async (_, { logger }) => {
    return {
      port: parseInt(process.env.PORT || "3000"),
      jwtSecret: process.env.JWT_SECRET || "your-secret-key",
    };
  },
});
