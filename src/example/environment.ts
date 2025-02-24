import { task, resource, env, run, EnvVars } from "../index";

// Extend the environment variables with custom interfaces
declare module "../env" {
  namespace EnvVars {
    interface IEnvironment {
      DATABASE_URL: string;
      PORT: number;
      DEBUG: boolean;
      API_KEYS: string[];
    }
  }
}

// Create a task that uses environment variables
const envDemoTask = task({
  id: "app.tasks.envDemo",
  dependencies: {
    env,
  },
  async run(_, { env }) {
    // Set environment variables with type casting
    env.set("PORT", { defaultValue: "3000", cast: "number" });
    env.set("DEBUG", { defaultValue: "false", cast: "boolean" });
    env.set("DATABASE_URL", {
      defaultValue: "mongodb://localhost:27017/myapp",
    });
    
    // Custom casting for API keys (comma-separated list to array)
    env.addCastHandler("array", (value) => value.split(",").map(item => item.trim()));
    env.set("API_KEYS", { 
      defaultValue: "key1,key2,key3", 
      cast: "array" 
    });

    // Now we can use the environment variables
    const port = env.get("PORT");
    console.log(`Server will run on port ${port}`);
    
    if (env.get("DEBUG")) {
      console.log("Debug mode is enabled");
    }
    
    console.log(`Database URL: ${env.get("DATABASE_URL")}`);
    console.log(`API Keys: ${env.get("API_KEYS").join(", ")}`);
    
    return {
      port,
      debug: env.get("DEBUG"),
      databaseUrl: env.get("DATABASE_URL"),
      apiKeys: env.get("API_KEYS"),
    };
  },
});

// Create the main application resource
const app = resource({
  id: "app",
  register: [envDemoTask, env],
  dependencies: {
    envDemoTask,
  },
  async init(_, { envDemoTask }) {
    // Run the environment demo task
    const config = await envDemoTask();
    console.log("Application initialized with config:", config);
    return config;
  },
});

// Example of how to use this in a main file
if (require.main === module) {
  // Set some environment variables for demonstration
  process.env.PORT = "4000";
  process.env.DEBUG = "true";
  
  // Run the application
  run(app).then((config) => {
    console.log("Application running with config:", config);
  }).catch(err => {
    console.error("Error running application:", err);
  });
}