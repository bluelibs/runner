import { defineTask, defineResource, defineMiddleware } from "../define";
import { run } from "../run";
import { CircularDependenciesError } from "../errors";
import { Store } from "../models/Store";
import { EventManager } from "../models/EventManager";
import { Logger } from "../models/Logger";
import { debugFindCircularDependencies } from "./debug-circular-deps";

describe("Debug Middleware Dependencies", () => {
  it("should debug global middleware dependency issue", async () => {
    const service = defineResource({
      id: "service",
      init: async () => "Service initialized",
    });

    const globalMiddleware = defineMiddleware({
      id: "global.middleware", 
      dependencies: { service },
      run: async ({ next }, { service }) => {
        return `Global[${service}]: ${await next()}`;
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        service,
        globalMiddleware.everywhere({ tasks: false, resources: true }),
      ],
      init: async () => "App initialized",
    });

    // Let's manually check the dependency graph
    const eventManager = new EventManager();
    const logger = new Logger(eventManager);
    const store = new Store(eventManager, logger);
    
    store.initializeStore(app, undefined);
    const dependentNodes = store.getDependentNodes();
    
    console.log("=== GLOBAL MIDDLEWARE DEBUG ===");
    const result = debugFindCircularDependencies(dependentNodes);
    console.log("Cycles found:", result.cycles);

    if (result.cycles.length > 0) {
      console.log("✅ Circular dependencies detected as expected!");
    } else {
      console.log("❌ No circular dependencies detected - this is the bug!");
    }
  });

  it("should debug why existing test works", async () => {
    const middleware: any = defineMiddleware({
      id: "middleware",
      dependencies: (): any => ({ task }),
      run: async (_: any, { task }: any) => {
        // example
      },
    });

    const task: any = defineTask({
      id: "task",
      middleware: [middleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "sub",
      async init(_, {}) {
        return "Sub initialized";
      },
      register: [middleware, task],
    });

    // Let's manually check the dependency graph
    const eventManager = new EventManager();
    const logger = new Logger(eventManager);
    const store = new Store(eventManager, logger);
    
    store.initializeStore(app, undefined);
    const dependentNodes = store.getDependentNodes();
    
    console.log("Existing test - Dependent nodes:");
    dependentNodes.forEach(node => {
      console.log(`- ${node.id}:`);
      if (node.dependencies && typeof node.dependencies === 'object') {
        for (const [key, depNode] of Object.entries(node.dependencies)) {
          console.log(`  -> ${key}: ${depNode ? depNode.id : 'null'}`);
        }
      }
    });

    try {
      await run(app);
      console.log("This should have failed!");
    } catch (error) {
      console.log("Error caught correctly:", (error as any).message);
      expect(error).toBeInstanceOf(CircularDependenciesError);
    }
  });
});