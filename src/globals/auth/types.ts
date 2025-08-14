/**
 * Core authentication types and interfaces for the BlueLibs Runner auth system
 */

/**
 * Basic user interface
 */
export interface IUser {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Internal user interface with password (for storage)
 */
export interface IUserWithPassword extends IUser {
  hashedPassword: string;
}

/**
 * User credentials for authentication
 */
export interface IUserCredentials {
  email: string;
  password: string;
}

/**
 * User registration data
 */
export interface IUserRegistration extends IUserCredentials {
  roles?: string[];
  metadata?: Record<string, any>;
}

/**
 * JWT token payload
 */
export interface IJWTPayload {
  userId: string;
  email: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

/**
 * Authentication result
 */
export interface IAuthResult {
  user: IUser;
  token: string;
  expiresAt: Date;
}

/**
 * Permission check context
 */
export interface IPermissionContext {
  user: IUser;
  resource?: string;
  action?: string;
  data?: any;
}

/**
 * Abstract user storage interface
 * Implement this interface to provide custom persistence layers
 */
export interface IUserStore {
  /**
   * Create a new user (with hashed password)
   */
  createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser>;

  /**
   * Find user by email (returns user with password for authentication)
   */
  findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null>;

  /**
   * Find user by ID (returns user with password for authentication)
   */
  findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null>;

  /**
   * Update user data
   */
  updateUser(id: string, updates: Partial<IUser>): Promise<IUser>;

  /**
   * Delete user
   */
  deleteUser(id: string): Promise<void>;

  /**
   * Check if user exists by email
   */
  existsByEmail(email: string): Promise<boolean>;

  /**
   * List users with optional filtering (without passwords)
   */
  listUsers(options?: {
    limit?: number;
    offset?: number;
    roles?: string[];
    isActive?: boolean;
  }): Promise<{ users: IUser[]; total: number }>;
}

/**
 * Abstract password hasher interface
 */
export interface IPasswordHasher {
  /**
   * Hash a password
   */
  hash(password: string): Promise<string>;

  /**
   * Verify a password against its hash
   */
  verify(password: string, hash: string): Promise<boolean>;
}

/**
 * Abstract JWT manager interface
 */
export interface IJWTManager {
  /**
   * Generate a JWT token for a user
   */
  generate(payload: IJWTPayload): Promise<string>;

  /**
   * Verify and decode a JWT token
   */
  verify(token: string): Promise<IJWTPayload>;

  /**
   * Check if a token is expired
   */
  isExpired(token: string): Promise<boolean>;
}

/**
 * Permission checker interface
 */
export interface IPermissionChecker {
  /**
   * Check if user has permission for a specific action
   */
  hasPermission(context: IPermissionContext): Promise<boolean>;

  /**
   * Check if user has any of the specified roles
   */
  hasRole(user: IUser, roles: string[]): Promise<boolean>;

  /**
   * Check if user has all of the specified roles
   */
  hasAllRoles(user: IUser, roles: string[]): Promise<boolean>;
}

/**
 * Authentication service configuration
 */
export interface IAuthConfig {
  /**
   * JWT secret key
   */
  jwtSecret: string;

  /**
   * JWT token expiration time in seconds (default: 24 hours)
   */
  jwtExpiresIn?: number;

  /**
   * Password minimum length (default: 8)
   */
  passwordMinLength?: number;

  /**
   * Default roles for new users
   */
  defaultRoles?: string[];

  /**
   * Enable user registration (default: true)
   */
  allowRegistration?: boolean;

  /**
   * Require email verification (default: false)
   */
  requireEmailVerification?: boolean;
}

/**
 * Authentication errors
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User with email ${email} already exists`);
    this.name = "UserAlreadyExistsError";
  }
}

export class UserNotFoundError extends Error {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`);
    this.name = "UserNotFoundError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}