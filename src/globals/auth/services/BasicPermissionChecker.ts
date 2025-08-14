import { IPermissionChecker, IPermissionContext, IUser } from "../types";

/**
 * Basic permission checker with role-based access control
 */
export class BasicPermissionChecker implements IPermissionChecker {
  private readonly roleHierarchy: Map<string, string[]> = new Map();
  private readonly permissions: Map<string, string[]> = new Map();

  constructor(config?: {
    roleHierarchy?: Record<string, string[]>;
    permissions?: Record<string, string[]>;
  }) {
    if (config?.roleHierarchy) {
      Object.entries(config.roleHierarchy).forEach(([role, inherits]) => {
        this.roleHierarchy.set(role, inherits);
      });
    }

    if (config?.permissions) {
      Object.entries(config.permissions).forEach(([resource, roles]) => {
        this.permissions.set(resource, roles);
      });
    }

    // Set up default roles and permissions
    this.setupDefaults();
  }

  async hasPermission(context: IPermissionContext): Promise<boolean> {
    const { user, resource, action } = context;

    // Super admin can do anything
    if (user.roles.includes("super_admin")) {
      return true;
    }

    // Check if user is active
    if (!user.isActive) {
      return false;
    }

    // If no specific resource or action, check if user has any valid role
    if (!resource && !action) {
      return user.roles.length > 0;
    }

    // Check resource-specific permissions
    if (resource) {
      const requiredRoles = this.permissions.get(resource) || [];
      if (requiredRoles.length === 0) {
        // No specific permissions required for this resource
        return true;
      }

      return this.hasAnyRole(user, requiredRoles);
    }

    return true;
  }

  async hasRole(user: IUser, roles: string[]): Promise<boolean> {
    return this.hasAnyRole(user, roles);
  }

  async hasAllRoles(user: IUser, roles: string[]): Promise<boolean> {
    const expandedUserRoles = this.expandRoles(user.roles);
    return roles.every((role) => expandedUserRoles.includes(role));
  }

  private hasAnyRole(user: IUser, roles: string[]): boolean {
    const expandedUserRoles = this.expandRoles(user.roles);
    return roles.some((role) => expandedUserRoles.includes(role));
  }

  /**
   * Expand roles based on hierarchy (e.g., admin inherits from user)
   */
  private expandRoles(userRoles: string[]): string[] {
    const expanded = new Set(userRoles);

    for (const role of userRoles) {
      const inherited = this.roleHierarchy.get(role) || [];
      inherited.forEach((inheritedRole) => expanded.add(inheritedRole));
    }

    return Array.from(expanded);
  }

  private setupDefaults(): void {
    // Default role hierarchy
    this.roleHierarchy.set("admin", ["user"]);
    this.roleHierarchy.set("super_admin", ["admin", "user"]);

    // Default permissions (resource -> required roles)
    this.permissions.set("user_management", ["admin", "super_admin"]);
    this.permissions.set("system_config", ["super_admin"]);
  }

  /**
   * Add a role hierarchy rule
   */
  addRoleHierarchy(role: string, inherits: string[]): void {
    this.roleHierarchy.set(role, inherits);
  }

  /**
   * Add permission rule for a resource
   */
  addPermission(resource: string, requiredRoles: string[]): void {
    this.permissions.set(resource, requiredRoles);
  }

  /**
   * Get all permissions (for debugging)
   */
  getPermissions(): Record<string, string[]> {
    return Object.fromEntries(this.permissions);
  }

  /**
   * Get role hierarchy (for debugging)
   */
  getRoleHierarchy(): Record<string, string[]> {
    return Object.fromEntries(this.roleHierarchy);
  }
}