import fs from "fs";
import os from "os";
import path from "path";

import { loadEnvFile } from "../app/config/env-file";

describe("env file loader", () => {
  test("parses key value lines and strips wrapping quotes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-runner-env-"));
    const filePath = path.join(dir, ".env");
    fs.writeFileSync(
      filePath,
      [
        "# comment",
        "OPENAI_API_KEY=abc123",
        'ASK_RUNNER_ADMIN_SECRET="secret value"',
        "ASK_RUNNER_MODEL='gpt-5'",
      ].join("\n"),
      "utf8",
    );

    const result = loadEnvFile(filePath);

    expect(result.OPENAI_API_KEY).toBe("abc123");
    expect(result.ASK_RUNNER_ADMIN_SECRET).toBe("secret value");
    expect(result.ASK_RUNNER_MODEL).toBe("gpt-5");
  });

  test("returns empty object when file is missing", () => {
    expect(loadEnvFile(path.join(os.tmpdir(), "missing-ask-runner-env"))).toEqual({});
  });
});
