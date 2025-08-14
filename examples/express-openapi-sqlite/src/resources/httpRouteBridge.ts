import { resource } from "@bluelibs/runner";
import { expressServerResource } from "../resources/expressServer";

/**
 * HTTP Route Bridge - Provides basic Express server setup
 * 
 * Route registration is now handled automatically by the routeRegistrationTask
 * which discovers tasks with HTTP tags via event listeners.
 */
export const httpRouteBridgeResource = resource({
  id: "app.resources.httpRouteBridge",
  dependencies: { 
    expressServer: expressServerResource,
  },
  init: async (_, { expressServer }) => {
    console.log('🔗 HTTP Route Bridge initialized - route registration handled by event listener');
    
    return { 
      expressServer,
      message: 'Routes are automatically registered via routeRegistrationTask'
    };
  }
});