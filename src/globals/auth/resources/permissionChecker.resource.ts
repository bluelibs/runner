import { defineResource } from "../../../define";
import { IAuthConfig } from "../types";
import { BasicPermissionChecker } from "../services/BasicPermissionChecker";

/**
 * Permission checker resource for authorization
 */
export const permissionCheckerResource = defineResource({
  id: "globals.auth.resources.permissionChecker",
  init: async (config: { 
    roleHierarchy?: Record<string, string[]>;
    permissions?: Record<string, string[]>;
    checker?: any;
  } = {}) => {
    // If a custom checker is provided, use it
    if (config.checker) {
      return config.checker;
    }
    
    // Default to basic permission checker
    return new BasicPermissionChecker({
      roleHierarchy: config.roleHierarchy,
      permissions: config.permissions,
    });
  },
  meta: {
    title: "Permission Checker",
    description: "Provides role-based permission checking and authorization",
    tags: ["auth", "authorization", "permissions"],
  },
});