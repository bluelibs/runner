import { EnvironmentManager } from "./models/EnvironmentManager";
import { defineResource } from "./define";

/**
 * The environment resource providing access to environment variables
 */
export const env = defineResource({
  id: "global.resources.env",
  init: async () => {
    const environmentManager = new EnvironmentManager();
    return environmentManager;
  },
  meta: {
    title: "Environment Manager",
    description: "Manages environment variables with type casting and defaults",
    tags: ["global"],
  },
});

/**
 * Type definition for extending environment variables in modules
 */
export declare namespace EnvVars {
  interface IEnvironment {
    // Base interface that can be extended by modules
  }
}