import { resource } from "@bluelibs/runner";

export const appConfig = resource({
  id: "app.modules.config",
  init: async (_) => {
    return {
      port: parseInt(process.env.PORT || "3000"),
      jwtSecret: process.env.JWT_SECRET || "your-secret-key",
    };
  },
});
