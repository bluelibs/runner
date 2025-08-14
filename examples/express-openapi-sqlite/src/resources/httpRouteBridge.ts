import { task, resource } from "@bluelibs/runner";
import { Request, Response } from "express";
import { httpTag } from "../tags/httpTag";
import { RequestContext, RequestData } from "../contexts";
import { expressServerResource } from "../resources/expressServer";
import { 
  registerUserTask, 
  loginUserTask, 
  getUserProfileTask, 
  getAllUsersTask 
} from "../tasks/userTasks";

/**
 * HTTP Route Bridge - Connects Express routes to Runner tasks
 */
export const httpRouteBridgeResource = resource({
  id: "app.resources.httpRouteBridge",
  dependencies: { 
    expressServer: expressServerResource,
    // Include all HTTP tasks as dependencies so they're registered
    registerUserTask,
    loginUserTask,
    getUserProfileTask,
    getAllUsersTask
  },
  init: async (_, { 
    expressServer, 
    registerUserTask,
    loginUserTask,
    getUserProfileTask,
    getAllUsersTask
  }) => {
    const { app } = expressServer;
    
    console.log('🔗 Setting up HTTP route bridges...');

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

          // Run task within request context
          const result = await RequestContext.provide(requestData, async () => {
            return await task(taskInput);
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

    // Register routes by examining task tags
    const routes = [
      { task: registerUserTask, method: 'post', path: '/api/auth/register' },
      { task: loginUserTask, method: 'post', path: '/api/auth/login' },
      { task: getUserProfileTask, method: 'get', path: '/api/auth/profile' },
      { task: getAllUsersTask, method: 'get', path: '/api/users' }
    ];

    routes.forEach(({ task, method, path }) => {
      const handler = createRouteHandler(task);
      (app as any)[method](path, handler);
      console.log(`📍 ${method.toUpperCase()} ${path} -> ${(task as any).id || 'anonymous'}`);
    });

    console.log('✅ All HTTP routes registered successfully');
    
    return { routesRegistered: routes.length };
  }
});