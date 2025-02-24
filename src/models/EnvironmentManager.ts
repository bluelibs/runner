type EnvCastType = "string" | "number" | "boolean" | "date" | "json";

interface IEnvOptions<T = any> {
  defaultValue?: T;
  cast?: EnvCastType;
}

/**
 * Manages environment variables with type casting and defaults
 */
export class EnvironmentManager {
  private envStore = new Map<string, any>();
  private castHandlers: Record<EnvCastType, (value: string) => any> = {
    string: (value) => value,
    number: (value) => {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    },
    boolean: (value) => {
      if (typeof value === "boolean") return value;
      return !["", "0", "false", "no", "undefined", "null"].includes(
        String(value).toLowerCase()
      );
    },
    date: (value) => new Date(value),
    json: (value) => JSON.parse(value),
  };

  /**
   * Set an environment variable with optional casting and default value
   * @param key The environment variable key
   * @param options Options for setting the variable
   * @returns The cast value
   */
  public set<T = any>(key: string, options: IEnvOptions<T> = {}): T {
    const { defaultValue, cast } = options;

    // Get from process.env first, then fall back to default
    const rawValue = process.env[key] ?? defaultValue;

    let value = rawValue;

    // Apply casting if specified and we have a string value
    if (cast && typeof rawValue === "string") {
      value = this.castHandlers[cast](rawValue);
    }

    this.envStore.set(key, value);
    return value as T;
  }

  /**
   * Get an environment variable with optional default value
   * @param key The environment variable key
   * @param defaultValue Optional default value if not found
   * @returns The environment variable value
   */
  public get<T = any>(key: string, defaultValue?: T): T {
    if (!this.envStore.has(key) && defaultValue !== undefined) {
      return defaultValue as T;
    }

    if (!this.envStore.has(key) && process.env[key] !== undefined) {
      // Lazily load from process.env if not in our store
      return this.set<T>(key, { defaultValue }) as T;
    }

    return (this.envStore.get(key) ?? defaultValue) as T;
  }

  /**
   * Add a custom casting function for a specific type
   * @param type The cast type
   * @param handler The casting function
   */
  public addCastHandler(type: string, handler: (value: string) => any): void {
    this.castHandlers[type as EnvCastType] = handler;
  }

  /**
   * Get all environment variables
   * @returns An object containing all env variables
   */
  public getAll(): Record<string, any> {
    return Object.fromEntries(this.envStore.entries());
  }
}
