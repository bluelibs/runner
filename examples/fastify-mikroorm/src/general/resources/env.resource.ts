import { r } from "@bluelibs/runner";

export interface EnvValues {
  NODE_ENV: string;
  PORT?: string;
  DATABASE_URL?: string;
  [key: string]: string | undefined;
}

const DEFAULTS: Partial<EnvValues> = {
  PORT: "3000",
  DATABASE_URL: "postgres://myuser:mysecretpassword@localhost:5433/clearspec",
};

export const env = r
  .resource("app.env.resources.env")
  .meta({
    title: "Environment Variables",
    description:
      "Exposes environment variables loaded by Node --env-file flags and process.env",
  })
  .init(async (): Promise<EnvValues> => {
    const nodeEnv = getNodeEnv();
    // Expect variables to be injected by Node's --env-file handling
    const all = readProcessEnv();
    return { ...DEFAULTS, NODE_ENV: nodeEnv, ...all } as EnvValues;
  })
  .build();

export function getNodeEnv(): string {
  return process.env.NODE_ENV || "development";
}

export function readProcessEnv(): Record<string, string | undefined> {
  return process.env;
}
