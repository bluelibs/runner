import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { r } from "@bluelibs/runner";

import { missingConfigError } from "../errors";

export interface AiDocsPrompt {
  content: string;
  version: string;
  filePath: string;
}

export const aiDocsPrompt = r
  .resource("aiDocsPrompt")
  .init(async (): Promise<AiDocsPrompt> => {
    const filePath = path.resolve(
      __dirname,
      "../../../../../readmes/COMPACT_GUIDE.md",
    );
    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim()) {
      missingConfigError.throw({
        message: `Prompt file ${filePath} is empty.`,
      });
    }

    const version = crypto.createHash("sha1").update(content).digest("hex");
    return { content, version, filePath };
  })
  .build();
