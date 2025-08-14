import { task, globals } from "@bluelibs/runner";
import { Request, Response } from "express";
import { httpTag } from "../tags/httpTag";
import { RequestContext, RequestData } from "../contexts";
import { expressServerResource } from "../resources/expressServer";

/**
 * Route Registration Task - Automatically discovers tasks with HTTP tags
 * and registers them as Express routes.
 * 
 * This task listens to the afterInit event and scans all tasks for httpTag metadata,
 * then automatically registers the corresponding Express routes.
 */
export const routeRegistrationTask = task({
  id: "app.tasks.routeRegistration",
  on: globals.events.afterInit,
  dependencies: { 
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    expressServer: expressServerResource,
  },
  run: async (_, { store, taskRunner, expressServer }) => {
    const { app } = expressServer;
    
    console.log('🔗 Discovering and registering HTTP routes from task tags...');

    // Helper to create route handler that bridges to Runner task
    const createRouteHandler = (task: any) => {
      return async (req: Request, res: Response) => {
        try {
          // Get request data
          const requestData: RequestData = (req as any).requestData;
          
          // Prepare task input with request context
          const taskInput = {
            ...req.body,
            ...req.params,
            ...req.query,
            request: req,
            response: res
          };

          // Run task within request context using TaskRunner
          const result = await RequestContext.provide(requestData, async () => {
            return await taskRunner.run(task, taskInput);
          });

          // Always send 200 with success/error in body
          res.status(200).json(result);
        } catch (error) {
          console.error('Route handler error:', error);
          res.status(200).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
          });
        }
      };
    };

    // Get all tasks and search for those with HTTP tags
    const allTasks = Array.from(store.tasks.values());
    let routesRegistered = 0;

    allTasks.forEach((taskElement) => {
      const task = taskElement.task;
      
      // Use httpTag.extract to get the tag configuration from the task
      const extractedTag = httpTag.extract(task.meta?.tags || []);
      
      if (extractedTag && extractedTag.config) {
        const { method, path } = extractedTag.config;
        
        if (method && path) {
          const handler = createRouteHandler(task);
          const httpMethod = method.toLowerCase();
          
          // Register the route
          (app as any)[httpMethod](path, handler);
          console.log(`📍 ${method} ${path} -> ${String(task.id)}`);
          routesRegistered++;
        }
      }
    });

    console.log(`✅ Automatically registered ${routesRegistered} HTTP routes from task tags`);
    
    return { routesRegistered };
  }
});