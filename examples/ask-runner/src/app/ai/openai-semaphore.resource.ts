import { Semaphore, r } from "@bluelibs/runner";

import { appConfig } from "../config/app-config.resource";

export const openAiSemaphore = r
  .resource("openAiSemaphore")
  .dependencies({ appConfig })
  .init(
    async (_, { appConfig }) =>
      new Semaphore(appConfig.maxConcurrentOpenAiCalls),
  )
  .dispose(async (semaphore) => {
    semaphore.dispose();
  })
  .build();
