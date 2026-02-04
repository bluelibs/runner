import { globals, r } from "@bluelibs/runner";

export const appConfig = r
  .resource("app.modules.config")
  .dependencies({ logger: globals.resources.logger })
  .init(async (_, { logger }) => {
    const isTest = process.env.NODE_ENV === "test";
    const listen =
      process.env.DISABLE_HTTP_LISTEN === "true" ? false : !isTest;

    return {
      port: parseInt(process.env.PORT || "3000"),
      host: process.env.HOST || "127.0.0.1",
      listen,
      jwtSecret: process.env.JWT_SECRET || "your-secret-key",
    };
  })
  .build();
