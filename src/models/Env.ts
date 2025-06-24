export type EnvCastType = "string" | "number" | "boolean" | "date";

export interface EnvVariableOptions<T = any> {
  /** Default value returned when the environment variable is not set */
  defaultValue?: T;
  /** How should the string value coming from process.env be cast */
  cast?: EnvCastType;
}

function castValue(raw: string | undefined, cast: EnvCastType | undefined) {
  if (raw === undefined) return undefined;

  switch (cast) {
    case "number":
      const n = parseFloat(raw);
      return isNaN(n) ? undefined : n;
    case "boolean":
      return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
    case "date":
      const d = new Date(raw);
      return isNaN(d.getTime()) ? undefined : d;
    case "string":
    default:
      return raw;
  }
}

export class Env {
  private registry: Map<string, EnvVariableOptions<any>> = new Map();

  /**
   * Register a new environment variable with optional metadata (default value & casting).
   */
  set<T = any>(key: string, options: EnvVariableOptions<T>) {
    this.registry.set(key, options);
  }

  /**
   * Retrieve an environment variable value applying casting & default value logic.
   */
  get<T = any>(key: string, defaultValue?: T): T {
    // Priority: provided defaultValue -> registry.defaultValue -> undefined
    const registered = this.registry.get(key);
    const castType = registered?.cast;
    const envRaw = process.env[key];
    const casted = castValue(envRaw, castType);

    if (casted !== undefined) {
      return casted as unknown as T;
    }

    if (registered && registered.defaultValue !== undefined) {
      return registered.defaultValue as T;
    }

    return defaultValue as T;
  }
}