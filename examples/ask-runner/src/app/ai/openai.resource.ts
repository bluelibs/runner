import { r } from "@bluelibs/runner";
import OpenAI from "openai";

import { appConfig } from "../config/app-config.resource";

export const openAiClient = r
  .resource("openAiClient")
  .dependencies({ appConfig })
  .init(async (_, { appConfig }): Promise<OpenAI> => {
    return new OpenAI({
      apiKey: appConfig.openAiApiKey,
      baseURL: appConfig.openAiApiUrl ?? undefined,
    });
  })
  .build();
