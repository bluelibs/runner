import { tag } from "@bluelibs/runner";
import { HttpRouteConfig } from "../types";

/**
 * HTTP tag for marking tasks as HTTP endpoints.
 * Contains route configuration including method, path, auth requirements, etc.
 */
export const httpTag = tag<HttpRouteConfig>({
  id: "http.route"
});

/**
 * Helper to create HTTP route tags with common configurations
 */
export const httpRoute = {
  get: (path: string, config?: Partial<HttpRouteConfig>) => 
    httpTag.with({ method: 'GET', path, ...config }),
  
  post: (path: string, config?: Partial<HttpRouteConfig>) => 
    httpTag.with({ method: 'POST', path, ...config }),
  
  put: (path: string, config?: Partial<HttpRouteConfig>) => 
    httpTag.with({ method: 'PUT', path, ...config }),
  
  delete: (path: string, config?: Partial<HttpRouteConfig>) => 
    httpTag.with({ method: 'DELETE', path, ...config }),
  
  patch: (path: string, config?: Partial<HttpRouteConfig>) => 
    httpTag.with({ method: 'PATCH', path, ...config })
};